import re
from datetime import timedelta
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import Count, Max, Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import NotAuthenticated, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from . import utils
from .helpers import (GUEST, attach_reactions, REACTIONS, touch_presence, blocked_ids, board_link_dict, can_message, can_see_profile, clean_photo, is_friend, mutual_follow, is_unlocked,
                      link_dict, require_unlocked, sign_unlock, user_min)
from .models import (Activity, BoardLinkReaction, Reaction, Block, Board, BoardInvite, BoardLink, BoardMember, BoardSave, Follow, Friendship, Link, LinkPage, Lock, Message, ShortLink)
from .views_auth import me_dict

User = get_user_model()
AUTO_DELETE_KINDS = {"link": "link", "qr": "qr", "board": "board_invite"}     # what a person can set to disappear: links, QR codes, boards (invites)
QR_MAX_WORDS = 100                      # words in a message sent as a QR code
AUTO_DELETE_CHOICES = (0, 1, 7, 30)      # days after which a person's messages delete themselves (0 = never)
MAX_INTERESTS = 6
MIN_INTERESTS = 1


def bad(msg, code=400):
    return Response({"detail": msg}, status=code)


def user_or_404(pk=None, username=None):
    q = User.objects.filter(pk=pk) if pk is not None else User.objects.filter(username=username)
    u = q.first()
    if not u:
        raise NotFound("User not found")
    return u


# ----------------------------------------------------------------- me / profile
@api_view(["GET", "PATCH"])
def me(request):
    u = request.user
    if request.method == "PATCH":
        d = request.data
        if "name" in d:
            name = (d["name"] or "").strip()[:60]
            if not name:
                return bad("Name cannot be empty.")
            u.name = name
        if "username" in d:
            un = (d["username"] or "").strip().lower().lstrip("@")
            from .views_auth import USERNAME_RX
            if not USERNAME_RX.match(un):
                return bad("Username: 3-20 letters, numbers or _.")
            if User.objects.exclude(pk=u.pk).filter(username=un).exists():
                return bad("That username is taken.")
            u.username = un
        if "is_private" in d:
            u.is_private = bool(d["is_private"])
        if "message_privacy" in d:
            if d["message_privacy"] not in ("anyone", "friends", "none"):
                return bad("Choose anyone, OPALS or no one.")
            u.message_privacy = d["message_privacy"]
        if "hide_adult" in d:
            u.hide_adult = bool(d["hide_adult"])
        if "qr_messages" in d:
            u.qr_messages = bool(d["qr_messages"])
        if "gender" in d:
            if d["gender"] not in ("", "female", "male", "other"):
                return bad("Choose female, male, other or nothing.")
            u.gender = d["gender"]
        if "country" in d:
            c = str(d["country"] or "").strip().upper()
            if c and not (len(c) == 2 and c.isalpha()):
                return bad("Choose a country from the list.")
            u.country = c
        for flag in ("show_gender", "show_country"):
            if flag in d:
                setattr(u, flag, bool(d[flag]))
        if "blocked_countries" in d:
            codes = d["blocked_countries"] if isinstance(d["blocked_countries"], list) else []
            u.blocked_countries = list(dict.fromkeys(str(c).strip().upper() for c in codes if len(str(c).strip()) == 2 and str(c).strip().isalpha()))[:60]
        if "blocked_keywords" in d:
            words = d["blocked_keywords"] if isinstance(d["blocked_keywords"], list) else []
            u.blocked_keywords = list(dict.fromkeys(" ".join(str(w).split()).lower()[:40] for w in words if str(w).strip()))[:60]
        if "invite_role" in d:
            if d["invite_role"] not in ("edit", "view"):
                return bad("Choose edit or view.")
            u.invite_role = d["invite_role"]
        if "invite_perms" in d:
            p = d["invite_perms"] if isinstance(d["invite_perms"], dict) else {}
            u.invite_perms = {k: bool(p.get(k)) for k in ("delete", "invite", "remove", "coown")}
        if "invite_analytics" in d:
            u.invite_analytics = bool(d["invite_analytics"])
        if "qr_private" in d:
            u.qr_private = bool(d["qr_private"])
        if "auto_delete" in d:
            ad = d["auto_delete"]
            if not isinstance(ad, dict) or any(k not in AUTO_DELETE_KINDS or v not in AUTO_DELETE_CHOICES for k, v in ad.items()):
                return bad("Choose never, 1, 7 or 30 days for links, QR codes or boards.")
            u.auto_delete = {**(u.auto_delete or {}), **ad}
        if "auto_delete_days" in d:
            if d["auto_delete_days"] not in AUTO_DELETE_CHOICES:
                return bad("Choose never, 1, 7 or 30 days.")
            u.auto_delete_days = d["auto_delete_days"]
        if "interests" in d:
            # people can type their own: "Street Food" becomes 'street-food', a built-in name maps to its id
            picked = [utils.clean_category(c) for c in d["interests"] if isinstance(c, str)]
            chosen = list(dict.fromkeys(c for c in picked if c))[:MAX_INTERESTS]           # at most 6, they show in the bio
            if len(chosen) < MIN_INTERESTS:
                return bad("Pick at least one interest.")
            u.interests = chosen
            u.interests_set = True
        if "interests_set" in d:
            u.interests_set = bool(d["interests_set"])
        if "blocked_categories" in d:
            u.blocked_categories = [c for c in d["blocked_categories"] if isinstance(c, str) and utils.clean_category(c) == c]
        if "photo" in d:
            try:
                u.photo = clean_photo(d["photo"])
            except ValueError as e:
                return bad(str(e))
        u.save()
    return Response(me_dict(u))


def category_counts():
    """{category id: number of public links using it}, built-in and typed-in categories alike."""
    counts = {}
    for row in Link.objects.filter(is_public=True, source="mine").values("category").annotate(n=Count("id")):
        counts[row["category"]] = counts.get(row["category"], 0) + row["n"]
    for row in BoardLink.objects.filter(board__is_public=True).values("category").annotate(n=Count("id")):
        counts[row["category"]] = counts.get(row["category"], 0) + row["n"]
    for row in Board.objects.filter(is_public=True).exclude(category="").values("category").annotate(n=Count("id")):    # boards count too
        counts[row["category"]] = counts.get(row["category"], 0) + row["n"]
    return counts


@api_view(["GET"])
@permission_classes([AllowAny])
def categories(request):
    counts = category_counts()
    if request.GET.get("used"):
        # only categories that exist in the database, with how many public links use each
        # (ones you already chose as interests stay listed so you can still untick them)
        mine = set(request.user.interests or []) if request.user.is_authenticated else set()
        ids = [i for i in counts if counts[i]] + [i for i in mine if not counts.get(i)]
        rows = [{"id": i, "name": utils.category_name(i), "count": counts.get(i, 0)} for i in ids]
    elif request.GET.get("options"):
        # for the "category" dropdown: every built-in one plus anything people typed, most used first
        ids = list(dict.fromkeys(utils.CATEGORY_IDS + list(counts)))
        rows = [{"id": i, "name": utils.category_name(i), "count": counts.get(i, 0)} for i in ids]
    else:
        # names for tags: the built-in list plus any typed-in categories in use
        ids = list(dict.fromkeys(utils.CATEGORY_IDS + list(counts)))
        return Response([{"id": i, "name": utils.category_name(i)} for i in ids])
    # categories that hold 18+ content are marked; they are left out when logged out or hiding 18+, and the picker only shows them when searched for
    adult_ids = set(Link.objects.filter(is_public=True, adult=True).values_list("category", flat=True)) | set(BoardLink.objects.filter(board__is_public=True, adult=True).values_list("category", flat=True))
    adult_ids.discard("other")
    if not request.user.is_authenticated or request.user.hide_adult:
        rows = [r for r in rows if r["id"] not in adult_ids]
    for r in rows:
        r["adult"] = r["id"] in adult_ids
    rows.sort(key=lambda r: (-r["count"], r["name"]))
    return Response(rows)


@api_view(["GET"])
def user_search(request):
    q = (request.GET.get("q") or "").strip().lstrip("@")
    if len(q) < 2:
        return Response([])
    qs = User.objects.filter(Q(username__icontains=q) | Q(name__icontains=q)).exclude(pk=request.user.pk)
    qs = qs.exclude(pk__in=blocked_ids(request.user))[:10]
    return Response([user_min(u, request.user) for u in qs])


def relation(viewer, target):
    f = Friendship.between(viewer, target)
    fol = Follow.objects.filter(follower=viewer, target=target).first()
    return {
        "friend": (("accepted" if f.status == "accepted" else ("outgoing" if f.requester_id == viewer.id else "incoming")) if f else None),
        "follow": fol.status if fol else None,
        "blocked": Block.objects.filter(blocker=viewer, blocked=target).exists(),
        "blocked_me": Block.objects.filter(blocker=target, blocked=viewer).exists(),
    }


@api_view(["GET"])
def profile(request, username):
    t = user_or_404(username=username)
    viewer = request.user
    rel = relation(viewer, t) if t.id != viewer.id else {}
    if rel.get("blocked_me"):
        raise NotFound("User not found")
    can = can_see_profile(viewer, t) and not rel.get("blocked")
    data = {**user_min(t, viewer), "is_private": t.is_private, "can_see": can, "relation": rel,
            "can_message": t.id != viewer.id and can_message(viewer, t),
            "followers": Follow.objects.filter(target=t, status="accepted").count(),
            "following": Follow.objects.filter(follower=t, status="accepted").count(), "links": [], "boards": [],
            "interests": [{"id": c, "name": utils.category_name(c)} for c in (t.interests or [])[:MAX_INTERESTS]],
            # gender and country show only when their owner chose to show them (you always see your own)
            "gender": t.gender if (can and (t.show_gender or t.id == viewer.id)) else "", "country": t.country if (can and (t.show_country or t.id == viewer.id)) else ""}
    if can:
        links = Link.objects.filter(owner=t, is_public=True, source="mine").select_related("owner")
        data["links"] = attach_reactions([link_dict(l, viewer) for l in links.exclude(category__in=viewer.blocked_categories)], viewer)
        locks = board_locks(viewer)
        pub = Board.objects.filter(owner=t, is_public=True).select_related("owner").prefetch_related("members", "boardmember_set")
        data["boards"] = board_list(pub, viewer, locks, with_links=True)
        data["card"] = t.cards.filter(on_profile=True).values_list("handle", flat=True).first()    # the card they chose to show on their profile
    return Response(data)


# ----------------------------------------------------------------- links
def apply_meta(link, meta):
    link.title = meta.get("title") or link.title
    link.description = meta.get("description") or link.description
    if not link.custom_image:
        link.image = meta.get("image") or link.image or utils.screenshot_url(link.url)
    link.logo = meta.get("logo") or link.logo


def build_link_fields(url, meta=None):
    host = utils.host_of(url)
    meta = meta or {}
    title = meta.get("title") or utils.pretty_host(host)
    return {"url": url, "key": utils.key_of(url), "host": host, "title": title[:300], "description": meta.get("description", ""),
            "image": meta.get("image") or utils.screenshot_url(url), "logo": meta.get("logo", ""),
            "category": utils.categorize(host, title)}


@api_view(["GET", "POST"])
def links(request):
    u = request.user
    if request.method == "GET":
        qs = Link.objects.filter(owner=u).select_related("owner", "saved_from")
        src = request.GET.get("source")
        if src in ("mine", "saved"):
            qs = qs.filter(source=src)
        return Response(attach_reactions([link_dict(l, u) for l in qs], u))      # reactions on your own public links too
    d = request.data
    url = utils.normalize_url(d.get("url"))
    if not url:
        return bad("That does not look like a valid link.")
    if Link.objects.filter(owner=u, key=utils.key_of(url)).exists():
        return bad("Already in your links.")
    meta = utils.fetch_meta(url)
    fields = build_link_fields(url, meta)
    image = d.get("image")
    custom = False
    if image:
        try:
            image = clean_photo(image)
            custom = True
        except ValueError as e:
            return bad(str(e))
    cat = utils.clean_category(d.get("category"))      # chosen or typed by the user; otherwise auto-detected
    if cat:
        fields["category"] = cat
    apply_name_and_description(fields, d)
    link = Link.objects.create(owner=u, is_public=bool(d.get("is_public")), adult=bool(d.get("adult")), source="mine",
                               custom_image=custom, **{**fields, **({"image": image} if custom else {})})
    board = None
    if d.get("new_board"):
        nb = d["new_board"]
        board = create_board(u, nb.get("name"), bool(nb.get("is_public")))
    elif d.get("board_id"):
        board = editable_board(u, d["board_id"])     # 403 for view-only members
    if board:
        pin_to_board(board, u, link_fields_of(link), None)
    return Response(link_dict(link, u), status=201)


def apply_name_and_description(fields, d):
    """A name / description the person typed or edited replaces what was read from the site (empty means keep the site's own)."""
    title = (d.get("title") or "").strip()
    if title:
        fields["title"] = title[:300]
    if "description" in d and (d.get("description") or "").strip():
        fields["description"] = (d["description"] or "").strip()[:1000]


def link_fields_of(l):
    return {"url": l.url, "key": l.key, "host": l.host, "title": l.title, "description": l.description,
            "image": l.image, "logo": l.logo, "category": l.category, "adult": l.adult}


def own_link(request, pk):
    l = Link.objects.filter(pk=pk, owner=request.user).select_related("owner", "saved_from").first()
    if not l:
        raise NotFound("Link not found")
    return l


@api_view(["PATCH", "DELETE"])
def link_detail(request, pk):
    l = own_link(request, pk)
    if request.method == "DELETE":
        l.delete()
        return Response(status=204)
    d = request.data
    if "title" in d:
        l.title = (d["title"] or "").strip()[:300] or l.title
        if "category" not in d:
            l.category = utils.categorize(l.host, l.title)
    cat = utils.clean_category(d.get("category"))
    if cat:
        l.category = cat
    if "description" in d:
        l.description = (d["description"] or "").strip()[:1000]
    if "adult" in d:
        l.adult = bool(d["adult"])
    if "is_public" in d and l.source == "mine":
        l.is_public = bool(d["is_public"])
        if not l.is_public:
            l.advertised = False
    if "image" in d:
        if d["image"]:
            try:
                l.image, l.custom_image = clean_photo(d["image"]), True
            except ValueError as e:
                return bad(str(e))
        else:
            l.custom_image, l.image = False, utils.screenshot_url(l.url)
    l.save()
    return Response(link_dict(l, request.user))


@api_view(["POST", "DELETE"])
def advertise(request, pk):
    l = own_link(request, pk)
    if request.method == "DELETE":
        l.advertised, l.advertised_at = False, None
        l.save(update_fields=["advertised", "advertised_at"])
        return Response(link_dict(l, request.user))
    if l.source == "saved":
        return bad("Saved links can't be advertised.")
    if not utils.is_active(l.url):
        return bad("This link isn't active right now, so it can't be advertised.")
    l.advertised, l.is_public = True, True
    l.advertised_at = timezone.now()
    l.pitch = (request.data.get("pitch") or "")[:200]
    l.save()
    return Response(link_dict(l, request.user))


@api_view(["POST"])
def save_link(request):
    """Save a link from Discover, a friend's profile, a board or a chat into Saved."""
    u, d = request.user, request.data
    poster = None
    if d.get("link_id"):
        src = Link.objects.filter(pk=d["link_id"]).select_related("owner").first()
        if not src or (src.owner_id != u.id and not (src.is_public and can_see_profile(u, src.owner))):
            raise NotFound("Link not found")
        fields, poster = link_fields_of(src), src.owner
    else:
        url = utils.normalize_url(d.get("url"))
        if not url:
            return bad("Invalid link.")
        fields = {**build_link_fields(url), "title": d.get("title") or utils.pretty_host(utils.host_of(url)), "image": d.get("image") or utils.screenshot_url(url), "adult": bool(d.get("adult"))}
        if d.get("from_user_id"):
            poster = User.objects.filter(pk=d["from_user_id"]).first()
    if Link.objects.filter(owner=u, key=fields["key"]).exists():
        return bad("Already in your links.")
    if poster and poster.id == u.id:
        poster = None
    l = Link.objects.create(owner=u, source="saved", saved_from=poster, is_public=False, **fields)
    if poster:
        orig = Link.objects.filter(owner=poster, key=fields["key"], source="mine").first()
        if orig:
            record("save", poster, u, link=orig)
    return Response(link_dict(l, u), status=201)


@api_view(["GET"])
def preview(request):
    url = utils.normalize_url(request.GET.get("url"))
    if not url:
        return bad("Invalid link.")
    meta = utils.fetch_meta(url)
    return Response({**build_link_fields(url, meta), "active": None})


@api_view(["POST"])
def check_url(request):
    url = utils.normalize_url(request.data.get("url"))
    return Response({"active": bool(url and utils.is_active(url))})


def category_search_q(q):
    """Match links whose category id or display name contains the search text."""
    q = (q or "").strip().lower()
    if not q:
        return Q()
    ids = [i for i, n, _ in utils.CATEGORIES if q in n.lower()]
    return Q(category__in=ids) | Q(category__icontains=re.sub(r"[^a-z0-9]+", "-", q).strip("-") or q)


@api_view(["GET"])
@permission_classes([AllowAny])
def discover(request):
    u = request.user
    guest = not u.is_authenticated      # people who are not logged in can browse what is public
    if guest:
        u = GUEST
        visible = Q(advertised=True) | Q(owner__is_private=False)
        hidden = set()
    else:
        # Every public link, plus advertised ones. Public links from private accounts only show to
        # people allowed to see that profile (self, accepted followers, friends); advertised always show.
        followed = Follow.objects.filter(follower=u, status="accepted").values_list("target_id", flat=True)
        friends = Friendship.objects.filter(Q(requester=u) | Q(addressee=u), status="accepted")
        friend_ids = {f.addressee_id if f.requester_id == u.id else f.requester_id for f in friends}
        visible = Q(advertised=True) | Q(owner__is_private=False) | Q(owner_id__in=set(followed) | friend_ids)
        hidden = blocked_ids(u)
    qs = Link.objects.filter(visible, source="mine", is_public=True).select_related("owner").order_by("-created")
    # Discover is other people's links; yours show up in *their* Discover
    if not guest:
        qs = qs.exclude(owner=u)
    qs = qs.exclude(owner_id__in=hidden).exclude(category__in=u.blocked_categories)
    qs = discover_blocks(qs, u, "owner", ("title", "description", "host", "url"))
    if u.hide_adult:
        qs = qs.filter(adult=False)
    q = (request.GET.get("q") or "").strip()
    cat_q = category_search_q(q)
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(host__icontains=q) | Q(description__icontains=q) | cat_q)
    out, seen = [], set()
    boost_from = timezone.now() - timedelta(hours=ADVERTISE_TOP_HOURS)
    for l in qs[:200]:
        d = link_dict(l, u)
        d["owner"] = None if guest else user_min(l.owner, u)          # logged out, nobody sees who posted it
        if l.advertised and l.advertised_at and l.advertised_at >= boost_from:
            d["_top"] = l.advertised_at.isoformat()          # freshly advertised: held at the top for a few hours
        out.append(d)
        seen.add(l.key)
    # Links pinned on public boards are public too. Same filters as above; one entry per URL.
    bq = BoardLink.objects.filter(board__is_public=True)
    if not guest:
        bq = bq.exclude(added_by=u).exclude(board__owner=u)
    bq = bq.exclude(added_by_id__in=hidden).exclude(board__owner_id__in=hidden) \
        .exclude(category__in=u.blocked_categories).select_related("added_by", "board")
    bq = discover_blocks(bq, u, "added_by", ("title", "description", "host", "url"))
    if u.hide_adult:
        bq = bq.filter(adult=False)
    if q:
        bq = bq.filter(Q(title__icontains=q) | Q(host__icontains=q) | Q(description__icontains=q) | cat_q)
    for bl in bq.order_by("-created")[:200]:
        if bl.key in seen:
            continue
        seen.add(bl.key)
        d = board_link_dict(bl, u)
        d.update({"id": f"b{bl.id}", "source": "board", "is_public": True, "owner": None if guest else user_min(bl.added_by, u),
                  "board": {"id": bl.board_id, "name": bl.board.name}})
        if guest:
            d.pop("added_by", None)
        out.append(d)
    # Newest first. A link that was just advertised sits above everything for ADVERTISE_TOP_HOURS, then drops to its own place in time.
    out.sort(key=lambda d: (bool(d.get("_top")), d.get("_top") or d["created"]), reverse=True)
    for d in out:
        d.pop("_top", None)
    return Response(attach_reactions(out, u))


def discover_blocks(qs, u, owner_field, text_fields):
    """Discover settings: hide what has any of my blocked keywords, and what people from my blocked countries post
    (only people who show their country, so blocking never gives a country away)."""
    for kw in getattr(u, "blocked_keywords", None) or []:
        cond = Q()
        for f in text_fields:
            cond |= Q(**{f + "__icontains": kw})
        qs = qs.exclude(cond)
    countries = getattr(u, "blocked_countries", None) or []
    if countries:
        qs = qs.exclude(**{owner_field + "__country__in": countries, owner_field + "__show_country": True})
    return qs


def followed_ids(u):
    """People you follow (accepted), minus anyone blocked either way."""
    ids = set(Follow.objects.filter(follower=u, status="accepted").values_list("target_id", flat=True))
    return ids - blocked_ids(u)


@api_view(["GET"])
def feed(request):
    """Friends tab: public links from the people you follow, newest first."""
    u = request.user
    qs = Link.objects.filter(owner_id__in=followed_ids(u), source="mine", is_public=True).exclude(category__in=u.blocked_categories)         .select_related("owner").order_by("-created")
    if u.hide_adult:
        qs = qs.filter(adult=False)
    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(host__icontains=q) | Q(description__icontains=q) | category_search_q(q))
    out = []
    for l in qs[:200]:
        d = link_dict(l, u)
        d["owner"] = user_min(l.owner, u)
        out.append(d)
    return Response(attach_reactions(out, u))


@api_view(["GET"])
def feed_boards(request):
    """Friends tab: public boards owned by people you follow."""
    u = request.user
    q = (request.GET.get("q") or "").strip()
    qs = Board.objects.filter(is_public=True, owner_id__in=followed_ids(u)).exclude(members=u)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(owner__username__icontains=q) | Q(owner__name__icontains=q))
    qs = qs.select_related("owner").prefetch_related("members", "boardmember_set").annotate(link_total=Count("links", distinct=True)).order_by("-id")[:50]
    locks = board_locks(u)
    return Response(board_list(qs, u, locks))


def record(kind, owner, actor, link=None, board=None):
    """Log a view / save / share for the owner's Analytics. Your own activity doesn't count, and repeat views within an hour are one."""
    if not actor or owner.id == actor.id:
        return
    since = timezone.now() - timedelta(hours=1)
    if kind == "view" and Activity.objects.filter(kind="view", actor=actor, link=link, board=board, created__gte=since).exists():
        return
    Activity.objects.create(kind=kind, owner=owner, actor=actor, link=link, board=board)


@api_view(["POST"])
def log_event(request):
    """The app reports views and shares of a link or board (saves are logged by the save endpoints)."""
    u, d = request.user, request.data
    kind = d.get("kind")
    if kind not in ("view", "share"):
        return bad("Unknown event.")
    if d.get("link_id") and str(d["link_id"]).isdigit():
        l = Link.objects.filter(pk=d["link_id"], source="mine", is_public=True).select_related("owner").first()
        if l and can_see_profile(u, l.owner):
            record(kind, l.owner, u, link=l)
    elif d.get("board_id") and str(d["board_id"]).isdigit():
        b = Board.objects.filter(pk=d["board_id"], is_public=True).select_related("owner").first()
        if b:
            record(kind, b.owner, u, board=b)
    return Response(status=204)


ADVERTISE_TOP_HOURS = 6        # how long an advertised link stays at the top of Discover
ANALYTICS_DAYS = (0, 1, 7, 30, 90, 180, 365)       # 0 = all time


def analytics_numbers(u, since):
    """The overview counts: everything that happened since `since` (None = ever)."""
    def within(qs, field="created"):
        return qs.filter(**{field + "__gte": since}) if since else qs
    acts = within(Activity.objects.filter(owner=u, card__isnull=True))      # links and boards; OCARD activity is counted on its own
    out = {k: acts.filter(kind=k).count() for k in ("view", "save", "share")}
    card_acts = within(Activity.objects.filter(owner=u, card__isnull=False))
    out["card_view"] = card_acts.filter(kind="view").count()
    out["card_click"] = card_acts.filter(kind="click").count()
    out["card_share"] = card_acts.filter(kind="share").count()
    out["reactions"] = within(Reaction.objects.filter(link__owner=u).exclude(user=u)).count()      # your own reactions on your own links are not "attention"
    out["board_saves"] = within(BoardSave.objects.filter(board__owner=u)).count()
    out["followers"] = within(Follow.objects.filter(target=u, status="accepted")).count()
    out["following"] = within(Follow.objects.filter(follower=u, status="accepted")).count()
    return out


def reaction_analytics(u, since):
    """What others reacted with on the links I posted (on my profile and on boards): the total, each emoji, the most reacted links, and the latest reactions."""
    mine = Reaction.objects.filter(link__owner=u).exclude(user=u).select_related("user", "link")
    on_boards = BoardLinkReaction.objects.filter(board_link__added_by=u).exclude(user=u).select_related("user", "board_link", "board_link__board")
    if since:
        mine, on_boards = mine.filter(created__gte=since), on_boards.filter(created__gte=since)
    by_emoji, items, recent = {}, {}, []
    for r in mine:
        by_emoji[r.emoji] = by_emoji.get(r.emoji, 0) + 1
        it = items.setdefault(("link", r.link_id), {"kind": "link", "id": r.link_id, "title": r.link.title, "host": r.link.host, "n": 0, "emojis": {}})
        it["n"] += 1
        it["emojis"][r.emoji] = it["emojis"].get(r.emoji, 0) + 1
        recent.append((r.created, {"who": r.user.display(), "emoji": r.emoji, "title": r.link.title, "at": r.created.isoformat()}))
    for r in on_boards:
        by_emoji[r.emoji] = by_emoji.get(r.emoji, 0) + 1
        bl = r.board_link
        it = items.setdefault(("board", bl.id), {"kind": "board", "id": bl.id, "title": bl.title, "host": f"on board “{bl.board.name}”", "n": 0, "emojis": {}})
        it["n"] += 1
        it["emojis"][r.emoji] = it["emojis"].get(r.emoji, 0) + 1
        recent.append((r.created, {"who": r.user.display(), "emoji": r.emoji, "title": bl.title, "at": r.created.isoformat()}))
    recent.sort(key=lambda x: x[0], reverse=True)
    return {"total": sum(by_emoji.values()),
            "by_emoji": [{"emoji": e, "n": n} for e, n in sorted(by_emoji.items(), key=lambda kv: -kv[1])],
            "items": sorted(items.values(), key=lambda i: -i["n"])[:50],
            "recent": [r for _, r in recent[:20]]}


def activity_trend(u, days):
    """Engagement over time for the dashboard charts: one bucket per hour (24 hours), day (up to 3 months), week (6 months) or month (a year, all time).
    Returns {"unit", "labels": [iso starts], "series": {"view": [...], "save": [...], "share": [...], "click": [...]}}."""
    now = timezone.now()
    if days == 1:
        unit, n = "hour", 24
        start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=n - 1)
        step = lambda s, i: s + timedelta(hours=i)
        key = lambda d: int((d.replace(minute=0, second=0, microsecond=0) - start).total_seconds() // 3600)
    elif days in (7, 30, 90):
        unit, n = "day", days
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=n - 1)
        step = lambda s, i: s + timedelta(days=i)
        key = lambda d: (d.replace(hour=0, minute=0, second=0, microsecond=0) - start).days
    elif days == 180:
        unit, n = "week", 26
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=7 * (n - 1))
        step = lambda s, i: s + timedelta(days=7 * i)
        key = lambda d: (d - start).days // 7
    else:
        unit, n = "month", 12
        start = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(days=330)).replace(day=1)
        step = lambda s, i: (s.replace(day=1) + timedelta(days=32 * i)).replace(day=1)
        key = None
    labels = [step(start, i) for i in range(n)]
    if key is None:                       # months have uneven lengths: find each activity's month by its label
        starts = [(l.year, l.month) for l in labels]
        key = lambda d: starts.index((d.year, d.month)) if (d.year, d.month) in starts else -1
        first = labels[0]
    else:
        first = start
    series = {k: [0] * n for k in ("view", "save", "share", "click")}
    for created, kind in Activity.objects.filter(owner=u, created__gte=first).values_list("created", "kind"):
        i = key(created)
        if kind in series and 0 <= i < n:
            series[kind][i] += 1
    return {"unit": unit, "labels": [l.isoformat() for l in labels], "series": series}


@api_view(["GET"])
def analytics(request):
    """Overview counts for the chosen period (?days=1|7|30|90|180|365, 0 or none = all time), next to the all-time totals."""
    u = request.user
    try:
        days = int(request.GET.get("days", 0))
    except ValueError:
        days = 0
    days = days if days in ANALYTICS_DAYS else 0
    since = timezone.now() - timedelta(days=days) if days else None
    over = analytics_numbers(u, since)
    totals = analytics_numbers(u, None)
    link_counts = {}
    link_acts = Activity.objects.filter(owner=u, link__isnull=False)
    if since:
        link_acts = link_acts.filter(created__gte=since)
    for r in link_acts.values("link_id", "kind").annotate(n=Count("id")):
        link_counts.setdefault(r["link_id"], {})[r["kind"]] = r["n"]
    reacts = Reaction.objects.filter(link__owner=u).exclude(user=u)
    if since:
        reacts = reacts.filter(created__gte=since)
    react_counts = dict(reacts.values_list("link_id").annotate(n=Count("id")))
    links = []
    for l in Link.objects.filter(owner=u, source="mine", is_public=True):
        c = link_counts.get(l.id, {})
        links.append({"id": l.id, "title": l.title, "host": l.host, "url": l.url, "image": l.image, "view": c.get("view", 0), "save": c.get("save", 0),
                      "share": c.get("share", 0), "react": react_counts.get(l.id, 0)})
    links.sort(key=lambda r: -(r["view"] * 1 + r["save"] * 3 + r["share"] * 2))
    board_counts = {}
    board_acts = Activity.objects.filter(owner=u, board__isnull=False)
    if since:
        board_acts = board_acts.filter(created__gte=since)
    for r in board_acts.values("board_id", "kind").annotate(n=Count("id")):
        board_counts.setdefault(r["board_id"], {})[r["kind"]] = r["n"]
    boards = []
    for b in Board.objects.filter(owner=u).annotate(n_saves=Count("saves", distinct=True), n_links=Count("links", distinct=True), n_members=Count("members", distinct=True)):
        c = board_counts.get(b.id, {})
        boards.append({"id": b.id, "name": b.name, "is_public": b.is_public, "save": b.n_saves, "view": c.get("view", 0), "share": c.get("share", 0),
                       "link_count": b.n_links, "member_count": b.n_members})
    boards.sort(key=lambda r: -(r["view"] + r["save"] * 3 + r["share"] * 2))
    # OCARDs: views, clicks on their links and shares, with the most clicked links of each
    card_counts, item_clicks = {}, {}
    card_acts = Activity.objects.filter(owner=u, card__isnull=False)
    if since:
        card_acts = card_acts.filter(created__gte=since)
    for r in card_acts.values("card_id", "kind").annotate(n=Count("id")):
        card_counts.setdefault(r["card_id"], {})[r["kind"]] = r["n"]
    for r in card_acts.filter(kind="click").values("card_id", "item").annotate(n=Count("id")):
        item_clicks.setdefault(r["card_id"], {})[r["item"]] = r["n"]
    cards = []
    for c in u.cards.order_by("id"):
        n = card_counts.get(c.id, {})
        names = {i["id"]: i["name"] for i in c.items or []}
        top = sorted(item_clicks.get(c.id, {}).items(), key=lambda kv: -kv[1])[:3]
        cards.append({"id": c.id, "name": c.name or u.display(), "handle": c.handle, "view": n.get("view", 0), "click": n.get("click", 0), "share": n.get("share", 0),
                      "link_count": len(c.items or []), "top": [{"name": names.get(i, "(removed link)"), "clicks": k} for i, k in top]})
    cards.sort(key=lambda r: -(r["view"] + r["click"] * 2 + r["share"] * 2))
    return Response({"days": days, "overview": over, "totals": totals, "links": links, "boards": boards, "cards": cards,
                     "reactions": reaction_analytics(u, since), "trend": activity_trend(u, days)})


@api_view(["GET"])
@permission_classes([AllowAny])
def discover_boards(request):
    """Open (public) boards for Discover; ?q= narrows by board name or owner."""
    u = request.user
    q = (request.GET.get("q") or "").strip()
    if not u.is_authenticated:
        qs = Board.objects.filter(is_public=True).exclude(id__in=BoardLink.objects.filter(adult=True).values("board_id"))     # no 18+ boards when logged out
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(owner__username__icontains=q) | Q(owner__name__icontains=q))
        qs = qs.select_related("owner").prefetch_related("members", "boardmember_set").annotate(link_total=Count("links", distinct=True)).order_by("-id")[:50]
        return Response(board_list(qs, GUEST, set()))
    qs = Board.objects.filter(is_public=True).exclude(owner_id__in=blocked_ids(u)).exclude(owner=u).exclude(members=u)   # not your own boards
    qs = discover_blocks(qs, u, "owner", ("name",))
    if request.GET.get("interests") == "1":          # My interests: only boards that hold links in the categories I picked
        qs = qs.filter(Q(id__in=BoardLink.objects.filter(category__in=u.interests or []).values("board_id")) | Q(category__in=u.interests or []))
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(owner__username__icontains=q) | Q(owner__name__icontains=q))
    qs = qs.select_related("owner").prefetch_related("members", "boardmember_set").annotate(link_total=Count("links", distinct=True)).order_by("-id")[:50]
    locks = board_locks(u)
    return Response(board_list(qs, u, locks))


# ----------------------------------------------------------------- boards
def board_slug(owner, name, exclude=None):
    """The board's name made safe for an address ("Travel photos" -> "travel-photos"), made unique among the owner's boards."""
    from django.utils.text import slugify
    base = (slugify(name) or "board")[:34]
    slug, n = base, 1
    while Board.objects.filter(owner=owner, slug=slug).exclude(pk=exclude).exists():
        n += 1
        slug = f"{base}-{n}"
    return slug


def create_board(user, name, is_public, category=None):
    name = (name or "").strip()[:30]
    if not name:
        raise ValidationError({"detail": "Give the board a name."})
    if Board.objects.filter(members=user, name__iexact=name).exists():
        raise ValidationError({"detail": "You already have a board with that name."})
    b = Board.objects.create(owner=user, name=name, slug=board_slug(user, name), is_public=is_public, category=utils.clean_category(category) or "")
    BoardMember.objects.create(board=b, user=user)
    return b


def pin_to_board(board, user, fields, from_user):
    if BoardLink.objects.filter(board=board, key=fields["key"]).exists():
        return None
    return BoardLink.objects.create(board=board, added_by=user, from_user=from_user, **fields)


def board_locks(viewer):
    """Ids (as strings) of the boards this user has PIN-locked, in one query."""
    return set(Lock.objects.filter(user=viewer, kind="board").values_list("target", flat=True))


def board_extras(boards, viewer):
    """For a list of boards: {board_id: up to 4 latest link pictures} and the set of board ids the viewer saved, in two queries."""
    ids = [b.id for b in boards]
    prev = {}
    for bid, img in BoardLink.objects.filter(board_id__in=ids).exclude(image="").order_by("board_id", "-created").values_list("board_id", "image"):
        got = prev.setdefault(bid, [])
        if len(got) < 4:
            got.append(img)
    saved = set(BoardSave.objects.filter(user=viewer, board_id__in=ids).values_list("board_id", flat=True)) if getattr(viewer, "is_authenticated", True) else set()
    return prev, saved


def board_list(boards, viewer, locks, with_links=False):
    boards = list(boards)
    prev, saved = board_extras(boards, viewer)
    return [board_summary(b, viewer, with_links=with_links, locks=locks, saved=saved, previews_map=prev) for b in boards]


def board_summary(b, viewer, with_links=False, request=None, locks=None, saved=None, previews_map=None):
    """`locks` (from board_locks) and a `link_total` annotation let lists of boards avoid one query per board."""
    members = list(b.members.all())
    is_member = any(m.id == viewer.id for m in members)
    roles = {bm.user_id: bm.role for bm in b.boardmember_set.all()}
    bm_all = {bm.user_id: bm for bm in b.boardmember_set.all()}
    analytics = {uid: bm.can_analytics for uid, bm in bm_all.items()}       # which collaborators the owner lets see the analytics
    extra = {uid: {f: getattr(bm, f) for _, f in PERM_FIELDS} for uid, bm in bm_all.items()}      # their extra permissions
    previews = previews_map.get(b.id, []) if previews_map is not None else list(b.links.exclude(image="").order_by("-created").values_list("image", flat=True)[:4])
    if b.image:
        previews = [b.image]     # a cover picked by the owner replaces the automatic preview
    locked = str(b.id) in locks if locks is not None else Lock.objects.filter(user=viewer, kind="board", target=str(b.id)).exists()
    d = {"id": b.id, "name": b.name, "slug": b.slug, "is_public": b.is_public, "owner": user_min(b.owner, viewer),
         "is_member": is_member, "is_owner": b.owner_id == viewer.id, "locked": locked,
         "can_edit": is_member and (b.owner_id == viewer.id or roles.get(viewer.id) == "edit"),
         "can_analytics": b.owner_id == viewer.id or (is_member and analytics.get(viewer.id, False)),
         "is_saved": (b.id in saved) if saved is not None else BoardSave.objects.filter(user=viewer, board=b).exists(),
         "previews": previews, "preview": previews[0] if previews else "",   # pictures of the latest links added (cover / collage)
         "color": b.color, "emoji": b.emoji, "image": b.image,
         "category": b.category, "category_name": utils.category_name(b.category) if b.category else "",
         "member_count": len(members), "link_count": b.link_total if hasattr(b, "link_total") else b.links.count(),
         "members": [{**user_min(m, viewer), "role": "edit" if m.id == b.owner_id else roles.get(m.id, "edit"), "can_analytics": m.id == b.owner_id or analytics.get(m.id, False),
                      **{f: (m.id == b.owner_id or bool(extra.get(m.id, {}).get(f))) for _, f in PERM_FIELDS}} for m in members] if is_member else []}
    me = board_power(b, viewer, bm_all.get(viewer.id)) if is_member or b.owner_id == viewer.id else board_power(b, GUEST)
    d["is_coowner"] = me["coown"] and not me["owner"]            # a co-owner: everything but deleting the board or removing the owner
    d["perms"] = {"delete": me["delete"], "invite": me["invite"], "remove": me["remove"], "manage": me["coown"]}   # what the viewer may do beyond adding links
    d["can_edit"] = d["can_edit"] or me["edit"]
    d["can_analytics"] = d["can_analytics"] or me["analytics"]
    if with_links:
        d["links"] = attach_reactions([board_link_dict(x, viewer) for x in b.links.select_related("added_by", "from_user")], viewer)
    if not getattr(viewer, "is_authenticated", True):
        # logged out: no profile of whoever made the board or added its links (the owner's username stays: it is in the board's address)
        d["owner"] = {"id": b.owner_id, "username": b.owner.username, "name": "", "photo": "", "nickname": "", "online": False}
        for l in d.get("links", []):
            l["owner"], l["added_by"] = None, None
    return d


def editable_board(user, pk):
    """The board, if this user may add / change links on it (owner, co-owner or an 'edit' member); else 403."""
    bm = BoardMember.objects.filter(board_id=pk, user=user).select_related("board").first()
    if not bm or (bm.role != "edit" and not bm.co_owner and bm.board.owner_id != user.id):
        raise PermissionDenied("You can only view this board." if bm else "Only collaborators can add links.")
    return bm.board


def board_power(board, user, bm=None):
    """What this person may do on a board. The owner can do everything. A co-owner can do everything but delete the board or remove the owner.
    An editor can add and change their own links, plus whatever the owner ticked for them: delete other people's links, invite OPALS, remove collaborators."""
    if getattr(user, "id", None) == board.owner_id:
        return {"owner": True, "coown": True, "edit": True, "delete": True, "invite": True, "remove": True, "analytics": True}
    bm = bm or BoardMember.objects.filter(board=board, user=user).first() if getattr(user, "is_authenticated", False) else None
    if not bm:
        return {"owner": False, "coown": False, "edit": False, "delete": False, "invite": False, "remove": False, "analytics": False}
    co = bm.co_owner
    edit = co or bm.role == "edit"
    return {"owner": False, "coown": co, "edit": edit, "delete": edit and (co or bm.can_delete), "invite": edit and (co or bm.can_invite),
            "remove": edit and (co or bm.can_remove), "analytics": co or bm.can_analytics}


PERM_FIELDS = (("delete", "can_delete"), ("invite", "can_invite"), ("remove", "can_remove"), ("coown", "co_owner"))


def board_for_view(request, pk):
    b = Board.objects.filter(pk=pk).select_related("owner").first()
    if not b:
        raise NotFound("Board not found")
    u = request.user
    member = b.members.filter(pk=u.pk).exists()
    invited = BoardInvite.objects.filter(board=b, to_user=u, status="pending").exists()
    saved = BoardSave.objects.filter(board=b, user=u).exists()   # a saved board stays viewable (frozen) after it goes private
    if not (b.is_public or member or invited or saved):
        raise NotFound("Board not found")
    return b, member


@api_view(["GET"])
@permission_classes([AllowAny])
def board_by_name(request, username, slug):
    """Open a board by its readable address: /boards/<owner>/<board name>. Returns the board's id (the board itself is still access-checked)."""
    b = Board.objects.filter(owner__username__iexact=username, slug=slug.lower()).first()
    if not b:
        raise NotFound("Board not found")
    return Response({"id": b.id})


@api_view(["GET", "POST"])
def boards(request):
    u = request.user
    if request.method == "POST":
        b = create_board(u, request.data.get("name"), bool(request.data.get("is_public")), request.data.get("category"))
        return Response(board_summary(b, u), status=201)
    locks = board_locks(u)
    qs = u.boards.select_related("owner").prefetch_related("members", "boardmember_set").annotate(link_total=Count("links", distinct=True))
    out = board_list(qs, u, locks)
    # boards other people own that you saved: live while public, frozen once made private
    for s in BoardSave.objects.filter(user=u).select_related("board__owner").prefetch_related("board__members", "board__boardmember_set")             .annotate(link_total=Count("board__links", distinct=True)):
        if s.board.is_public or not s.snapshot:
            s.board.link_total = s.link_total
            d = board_summary(s.board, u, locks=locks)
        else:
            d = {k: val for k, val in s.snapshot.items() if k != "links"}
        d.update({"saved": True, "frozen": not s.board.is_public, "is_saved": True})
        out.append(d)
    return Response(out)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def board_detail(request, pk):
    if not request.user.is_authenticated:
        if request.method != "GET":
            raise NotAuthenticated()
        b = Board.objects.filter(pk=pk, is_public=True).select_related("owner").first()
        if not b or b.links.filter(adult=True).exists():
            raise NotFound("Board not found")
        return Response(board_summary(b, GUEST, with_links=True, locks=set(), saved=set()))
    b, member = board_for_view(request, pk)
    u = request.user
    if request.method == "GET":
        if member:
            require_unlocked(request, "board", b.id)
        if b.is_public and not member:
            record("view", b.owner, u, board=b)
        if not b.is_public and not member:
            s = BoardSave.objects.filter(board=b, user=u).first()
            if s and s.snapshot:
                return Response({**s.snapshot, "frozen": True, "is_saved": True})
        return Response(board_summary(b, u, with_links=True))
    if request.method == "DELETE":
        if b.owner_id != u.id:
            raise PermissionDenied("Only the owner can delete the board.")      # not even a co-owner
        b.delete()
        return Response(status=204)
    if not board_power(b, u)["coown"]:
        raise PermissionDenied("Only the owner or a co-owner can do that.")
    d = request.data
    if "name" in d and (d["name"] or "").strip():
        b.name = d["name"].strip()[:30]
    if "color" in d:
        c = (d["color"] or "").strip()
        if c and not re.fullmatch(r"#[0-9a-fA-F]{6}", c):
            return bad("Pick a valid colour.")
        b.color = c
    if "emoji" in d:
        b.emoji = (d["emoji"] or "").strip()[:8]
    if "category" in d:
        b.category = utils.clean_category(d["category"]) or ""
    if "image" in d:
        try:
            b.image = clean_photo(d["image"])
        except ValueError as e:
            return bad(str(e))
    if "is_public" in d:
        was, b.is_public = b.is_public, bool(d["is_public"])
        if was and not b.is_public:      # going private: savers keep what they had, it stops updating
            for s in b.saves.select_related("user"):
                s.snapshot = board_summary(b, s.user, with_links=True)
                s.save(update_fields=["snapshot"])
        elif b.is_public and not was:    # public again: savers follow it live once more
            b.saves.update(snapshot=None)
    b.save()
    return Response(board_summary(b, u))


@api_view(["POST", "DELETE"])
def board_save(request, pk):
    """Save (POST) or unsave (DELETE) somebody's public board so it shows in your Boards."""
    u = request.user
    b = Board.objects.filter(pk=pk).select_related("owner").first()
    if not b:
        raise NotFound("Board not found")
    if request.method == "DELETE":
        BoardSave.objects.filter(board=b, user=u).delete()
        return Response(status=204)
    if not b.is_public or b.owner_id in blocked_ids(u):
        raise NotFound("Board not found")
    if b.members.filter(pk=u.pk).exists():
        raise ValidationError({"detail": "You are already on this board."})
    BoardSave.objects.get_or_create(board=b, user=u)
    record("save", b.owner, u, board=b)
    return Response(board_summary(b, u), status=201)


@api_view(["POST"])
def board_add_link(request, pk):
    b = editable_board(request.user, pk)
    require_unlocked(request, "board", b.id)
    d = request.data
    url = utils.normalize_url(d.get("url"))
    if not url:
        return bad("That does not look like a valid link.")
    if BoardLink.objects.filter(board=b, key=utils.key_of(url)).exists():
        return bad("Already on this board.")
    fields = build_link_fields(url, utils.fetch_meta(url))
    if d.get("image"):
        try:
            fields["image"] = clean_photo(d["image"])
        except ValueError as e:
            return bad(str(e))
    fields["adult"] = bool(d.get("adult"))
    cat = utils.clean_category(d.get("category"))
    if cat:
        fields["category"] = cat
    apply_name_and_description(fields, d)
    bl = pin_to_board(b, request.user, fields, None)
    # the link is also yours: it appears in All (Mine + Saved) as well as on the board
    Link.objects.get_or_create(owner=request.user, key=fields["key"], defaults={**link_fields_of(bl), "source": "mine", "is_public": False})
    return Response(board_link_dict(bl, request.user), status=201)


@api_view(["GET"])
def board_activity(request, pk):
    """Recent things that happened on a board: links added, people joining."""
    b, member = board_for_view(request, pk)
    u = request.user
    items = [{"kind": "link", "who": user_min(x.added_by, u), "title": x.title, "url": x.url, "at": x.created.isoformat()}
             for x in b.links.select_related("added_by").order_by("-created")[:40]]
    items += [{"kind": "join", "who": user_min(m.user, u), "at": m.joined.isoformat()}
              for m in BoardMember.objects.filter(board=b).exclude(user=b.owner).select_related("user").order_by("-joined")[:20]]
    items.sort(key=lambda i: i["at"], reverse=True)
    return Response(items[:40])


def valid_emoji(text):
    """Any single emoji a person picks themselves: a few characters, none of them plain letters, digits, punctuation or spaces."""
    return 0 < len(text) <= 8 and all(not c.isascii() and not c.isalpha() and not c.isspace() for c in text)


@api_view(["POST"])
def link_react(request, pk):
    """React to somebody's public link with one emoji (send an empty emoji to remove yours)."""
    u = request.user
    l = Link.objects.filter(pk=pk, source="mine", is_public=True).select_related("owner").first()
    if not l or not can_see_profile(u, l.owner) or l.owner_id in blocked_ids(u):
        raise NotFound("Link not found")
    emoji = (request.data.get("emoji") or "").strip()
    if not emoji:
        Reaction.objects.filter(user=u, link=l).delete()
    elif emoji in REACTIONS or valid_emoji(emoji):
        Reaction.objects.update_or_create(user=u, link=l, defaults={"emoji": emoji})
    else:
        return bad("Unknown reaction.")
    return Response(attach_reactions([{"id": l.id}], u)[0])


@api_view(["POST"])
def board_link_react(request, lid):
    """React to a link on a board with one emoji (an empty emoji removes yours). Anyone who can see the board may react."""
    u = request.user
    bl = BoardLink.objects.filter(pk=lid).select_related("board", "added_by").first()
    if not bl or bl.added_by_id in blocked_ids(u) or not (bl.board.is_public or bl.board.members.filter(pk=u.pk).exists()):
        raise NotFound("Link not found")
    emoji = (request.data.get("emoji") or "").strip()
    if not emoji:
        BoardLinkReaction.objects.filter(user=u, board_link=bl).delete()
    elif emoji in REACTIONS or valid_emoji(emoji):
        BoardLinkReaction.objects.update_or_create(user=u, board_link=bl, defaults={"emoji": emoji})
    else:
        return bad("Unknown reaction.")
    return Response(attach_reactions([{"id": bl.id, "board_link": True}], u)[0])


@api_view(["GET"])
def link_stats(request, pk):
    """The owner's numbers for one posted link: views, saves, shares and reactions over a period, plus a per-day trend and who reacted with what."""
    u = request.user
    l = Link.objects.filter(pk=pk, owner=u, source="mine").first()
    if not l:
        raise NotFound("Link not found")
    try:
        days = int(request.GET.get("days", 0))
    except ValueError:
        days = 0
    days = days if days in ANALYTICS_DAYS else 0
    since = timezone.now() - timedelta(days=days) if days else None
    acts = Activity.objects.filter(link=l)
    reacts = Reaction.objects.filter(link=l).exclude(user=u)
    if since:
        acts, reacts = acts.filter(created__gte=since), reacts.filter(created__gte=since)
    counts = {r["kind"]: r["n"] for r in acts.values("kind").annotate(n=Count("id"))}
    by_emoji = {r["emoji"]: r["n"] for r in reacts.values("emoji").annotate(n=Count("id")).order_by("-n")}
    # last 7 days, one row per day (oldest first)
    today = timezone.localdate()
    trend = []
    week = Activity.objects.filter(link=l, created__gte=timezone.now() - timedelta(days=7))
    per_day = {}
    for a in week:
        per_day.setdefault(timezone.localtime(a.created).date(), {}).setdefault(a.kind, 0)
        per_day[timezone.localtime(a.created).date()][a.kind] += 1
    for k in range(6, -1, -1):
        day = today - timedelta(days=k)
        c = per_day.get(day, {})
        trend.append({"date": day.isoformat(), "view": c.get("view", 0), "save": c.get("save", 0), "share": c.get("share", 0)})
    return Response({"days": days, "title": l.title, "public": l.is_public, "view": counts.get("view", 0), "save": counts.get("save", 0), "share": counts.get("share", 0),
                     "react": sum(by_emoji.values()), "reactions": by_emoji, "trend": trend, "posted": l.created.isoformat()})


@api_view(["GET"])
def board_stats(request, pk):
    """The owner's numbers for one board: views, saves, shares and reactions on its links over a period, a 7-day trend and its most reacted links."""
    u = request.user
    # the owner, or a collaborator the owner let see the analytics (when inviting them, or later in the people list)
    b = Board.objects.filter(pk=pk).filter(Q(owner=u) | Q(boardmember__user=u, boardmember__can_analytics=True) | Q(boardmember__user=u, boardmember__co_owner=True)).distinct().first()
    if not b:
        raise NotFound("Board not found")
    try:
        days = int(request.GET.get("days", 0))
    except ValueError:
        days = 0
    days = days if days in ANALYTICS_DAYS else 0
    since = timezone.now() - timedelta(days=days) if days else None
    acts = Activity.objects.filter(board=b)
    saves = BoardSave.objects.filter(board=b)
    reacts = BoardLinkReaction.objects.filter(board_link__board=b).exclude(user=u)
    if since:
        acts, saves, reacts = acts.filter(created__gte=since), saves.filter(created__gte=since), reacts.filter(created__gte=since)
    counts = {r["kind"]: r["n"] for r in acts.values("kind").annotate(n=Count("id"))}
    by_emoji = {r["emoji"]: r["n"] for r in reacts.values("emoji").annotate(n=Count("id")).order_by("-n")}
    top = [{"title": r["board_link__title"], "n": r["n"]} for r in reacts.values("board_link__title").annotate(n=Count("id")).order_by("-n")[:3]]
    today = timezone.localdate()
    per_day = {}
    for a in Activity.objects.filter(board=b, created__gte=timezone.now() - timedelta(days=7)):
        d = timezone.localtime(a.created).date()
        per_day.setdefault(d, {})[a.kind] = per_day.get(d, {}).get(a.kind, 0) + 1
    trend = []
    for k in range(6, -1, -1):
        day = today - timedelta(days=k)
        c = per_day.get(day, {})
        trend.append({"date": day.isoformat(), "view": c.get("view", 0), "save": c.get("save", 0), "share": c.get("share", 0)})
    return Response({"days": days, "public": b.is_public, "view": counts.get("view", 0), "save": max(saves.count(), counts.get("save", 0)), "share": counts.get("share", 0),
                     "react": sum(by_emoji.values()), "reactions": by_emoji, "top": top, "trend": trend,
                     "link_count": b.links.count(), "member_count": b.members.count()})


@api_view(["POST"])
def board_pin(request, pk):
    """'Save to board' for any link (own, Discover, chat...)."""
    b = editable_board(request.user, pk)
    d = request.data
    if d.get("link_id"):
        src = Link.objects.filter(pk=d["link_id"]).select_related("owner").first()
        if not src or (src.owner_id != request.user.id and not (src.is_public and can_see_profile(request.user, src.owner))):
            raise NotFound("Link not found")
        fields, poster = link_fields_of(src), (src.saved_from if src.source == "saved" else src.owner)
    else:
        url = utils.normalize_url(d.get("url"))
        if not url:
            return bad("Invalid link.")
        fields = {**build_link_fields(url), "title": d.get("title") or utils.pretty_host(utils.host_of(url)), "adult": bool(d.get("adult"))}
        poster = User.objects.filter(pk=d.get("from_user_id")).first() if d.get("from_user_id") else None
    if poster and poster.id == request.user.id:
        poster = None
    bl = pin_to_board(b, request.user, fields, poster)
    if not bl:
        return bad(f"Already in {b.name}.")
    if poster:
        orig = Link.objects.filter(owner=poster, key=fields["key"], source="mine").first()
        if orig:
            record("save", poster, request.user, link=orig)
    return Response(board_link_dict(bl, request.user), status=201)


@api_view(["PATCH", "DELETE"])
def board_link_detail(request, pk, lid):
    b = editable_board(request.user, pk)
    bl = BoardLink.objects.filter(pk=lid, board=b).first()
    if not bl:
        raise NotFound("Link not found")
    power = board_power(b, request.user)
    if bl.added_by_id != request.user.id:
        # other people's links: the owner and co-owners may change or delete them; an editor needs the delete permission to delete
        if request.method == "DELETE" and not power["delete"]:
            raise PermissionDenied("You can only delete links you added.")
        if request.method != "DELETE" and not power["coown"]:
            raise PermissionDenied("You can only change links you added.")
    if request.method == "DELETE":
        bl.delete()
        return Response(status=204)
    d = request.data
    for f in ("title", "description"):
        if f in d:
            setattr(bl, f, (d[f] or "").strip()[:300 if f == "title" else 1000])
    if "adult" in d:
        bl.adult = bool(d["adult"])
    bl.save()
    return Response(board_link_dict(bl, request.user))


def perm_choices(data, giver_power):
    """The permissions asked for in a request (role, analytics, extras), kept within what the person giving them may give.
    Only the owner can make a co-owner; a co-owner has every permission."""
    role = "view" if data.get("role") == "view" else "edit"
    out = {"role": role, "can_analytics": bool(data.get("can_analytics")), "can_delete": False, "can_invite": False, "can_remove": False, "co_owner": False}
    if role == "edit":
        for key, field in PERM_FIELDS:
            wanted = bool(data.get(field))
            if key == "coown":
                out[field] = wanted and giver_power["owner"]
            else:
                out[field] = wanted and giver_power[key]          # you can't hand out a permission you don't have
        if out["co_owner"]:
            out.update(can_delete=True, can_invite=True, can_remove=True, can_analytics=True)
    return out


@api_view(["POST"])
def board_invite(request, pk):
    b = Board.objects.filter(pk=pk).first()
    if not b:
        raise NotFound("Board not found")
    me = board_power(b, request.user)
    if not me["invite"]:
        raise PermissionDenied("You can't invite people to this board.")
    to = user_or_404(pk=request.data.get("user_id"))
    if not is_friend(request.user, to):
        return bad("You can only invite OPALS.")
    if b.members.filter(pk=to.pk).exists():
        return bad("Already on this board.")
    inv, _ = BoardInvite.objects.update_or_create(board=b, to_user=to, defaults={"from_user": request.user, "status": "pending", **perm_choices(request.data, me)})
    Message.objects.create(sender=request.user, recipient=to, kind="board_invite", invite=inv, title=b.name)
    return Response({"id": inv.id, "status": inv.status}, status=201)


@api_view(["POST"])
def invite_respond(request, pk, action):
    inv = BoardInvite.objects.filter(pk=pk, to_user=request.user).select_related("board").first()
    if not inv:
        raise NotFound("Invite not found")
    if action == "accept":
        inv.status = "accepted"
        BoardMember.objects.update_or_create(board=inv.board, user=request.user, defaults={
            "role": inv.role, "can_analytics": inv.can_analytics, "can_delete": inv.can_delete, "can_invite": inv.can_invite,
            "can_remove": inv.can_remove, "co_owner": inv.co_owner})
    elif action == "decline":
        inv.status = "declined"
        BoardMember.objects.filter(board=inv.board, user=request.user).delete()
    else:
        return bad("Unknown action.")
    inv.save()
    return Response({"id": inv.id, "status": inv.status})


@api_view(["PATCH", "DELETE"])
def board_member(request, pk, uid):
    b = Board.objects.filter(pk=pk).first()
    if not b:
        raise NotFound("Board not found")
    me = board_power(b, request.user)
    target = BoardMember.objects.filter(board=b, user_id=uid).first()
    if request.method == "PATCH":      # the owner and co-owners set what a collaborator may do
        if not me["coown"]:
            raise PermissionDenied("Only the owner or a co-owner can change access.")
        if uid == b.owner_id:
            return bad("The owner's access can't be changed.")
        if not target:
            raise NotFound("Not a collaborator")
        if target.co_owner and not me["owner"]:
            raise PermissionDenied("Only the owner can change a co-owner.")
        d = request.data
        role = d.get("role")
        if role is not None and role not in ("view", "edit"):
            return bad("Choose view or edit.")
        asked = [k for k in ("role", "can_analytics", "can_delete", "can_invite", "can_remove", "co_owner") if k in d]
        if not asked:
            return bad("Nothing to change.")
        if "co_owner" in d and not me["owner"]:
            raise PermissionDenied("Only the owner can make a co-owner.")
        changes = {}
        if role is not None:
            changes["role"] = role
        for k in ("can_analytics", "can_delete", "can_invite", "can_remove", "co_owner"):
            if k in d:
                changes[k] = bool(d[k])
        if changes.get("role") == "view":
            changes.update(can_delete=False, can_invite=False, can_remove=False, co_owner=False)      # a viewer has no extra powers
        if changes.get("co_owner"):
            changes.update(role="edit", can_delete=True, can_invite=True, can_remove=True, can_analytics=True)
        for k, v in changes.items():
            setattr(target, k, v)
        target.save()
        return Response({"id": uid, **changes})
    # leaving is for anyone; removing someone needs the remove permission
    if request.user.id != uid:
        if not me["remove"]:
            raise PermissionDenied("You can't remove people from this board.")
        if uid == b.owner_id:
            return bad("The owner can't be removed.")
        if target and target.co_owner and not me["owner"]:
            raise PermissionDenied("Only the owner can remove a co-owner.")
    if uid == b.owner_id:
        return bad("The owner cannot leave. Delete the board instead.")
    BoardMember.objects.filter(board=b, user_id=uid).delete()
    return Response(status=204)


# ----------------------------------------------------------------- follows
def sync_friendship(a, b):
    """Following each other makes you friends. Returns True if they are friends."""
    if not mutual_follow(a, b):
        return False
    f = Friendship.between(a, b)
    if f:
        if f.status != "accepted":
            f.status = "accepted"
            f.save(update_fields=["status"])
    else:
        Friendship.objects.create(requester=a, addressee=b, status="accepted")
    return True


@api_view(["POST", "DELETE"])
def follow(request, username):
    t = user_or_404(username=username)
    u = request.user
    if t.id == u.id or t.id in blocked_ids(u):
        return bad("You can't follow this user.")
    if request.method == "DELETE":
        Follow.objects.filter(follower=u, target=t).delete()
        Friendship.objects.filter(Q(requester=u, addressee=t) | Q(requester=t, addressee=u)).delete()   # friends must follow each other
        return Response(status=204)
    st = "pending" if t.is_private else "accepted"
    f, created = Follow.objects.get_or_create(follower=u, target=t, defaults={"status": st})
    return Response({"status": f.status, "friends": sync_friendship(u, t)}, status=201 if created else 200)


@api_view(["GET"])
def follow_lists(request, username, which):
    t = user_or_404(username=username)
    if not can_see_profile(request.user, t):
        raise PermissionDenied("This profile is private.")
    if which == "followers":
        qs = Follow.objects.filter(target=t, status="accepted").select_related("follower").order_by("-created", "-id")   # newest first
        users = [f.follower for f in qs]
    else:
        qs = Follow.objects.filter(follower=t, status="accepted").select_related("target").order_by("-created", "-id")
        users = [f.target for f in qs]
    hidden = blocked_ids(request.user)
    rows = [user_min(x, request.user) for x in users if x.id not in hidden]
    if t.id == request.user.id:    # your own lists: who you follow / who follows you, for the Follow back / Following buttons
        mine = set(Follow.objects.filter(follower=t, status="accepted").values_list("target_id", flat=True))
        theirs = set(Follow.objects.filter(target=t, status="accepted").values_list("follower_id", flat=True))
        rows = [{**r, "i_follow": r["id"] in mine, "follows_me": r["id"] in theirs} for r in rows]
    return Response(rows)


@api_view(["GET"])
def follow_requests(request):
    qs = Follow.objects.filter(target=request.user, status="pending").select_related("follower")
    hidden = blocked_ids(request.user)
    return Response([{"id": f.id, "user": user_min(f.follower, request.user)} for f in qs if f.follower_id not in hidden])


@api_view(["GET", "POST"])
def follower_alerts(request):
    """GET: recent followers (new ones flagged) + pending requests. POST: mark them all as seen."""
    u = request.user
    hidden = blocked_ids(u)
    qs = Follow.objects.filter(target=u).exclude(follower_id__in=hidden).select_related("follower")
    if request.method == "POST":
        qs.filter(status="accepted", seen=False).update(seen=True)
        return Response({"ok": True})
    mine = set(Follow.objects.filter(follower=u).values_list("target_id", flat=True))   # people I follow (or asked to)
    rows = [{"id": f.id, "user": user_min(f.follower, u), "status": f.status, "new": f.status == "accepted" and not f.seen,
             "i_follow": f.follower_id in mine, "created": f.created.isoformat()} for f in qs.order_by("-created")[:50]]
    return Response(rows)


@api_view(["POST"])
def follow_request_respond(request, pk, action):
    f = Follow.objects.filter(pk=pk, target=request.user, status="pending").first()
    if not f:
        raise NotFound("Request not found")
    if action == "accept":
        f.status = "accepted"
        f.save()
        sync_friendship(f.follower, request.user)
    else:
        f.delete()
    return Response({"ok": True})


# ----------------------------------------------------------------- friends & messages
def friend_row(f, me_user):
    other = f.addressee if f.requester_id == me_user.id else f.requester
    st = "accepted" if f.status == "accepted" else ("outgoing" if f.requester_id == me_user.id else "incoming")
    return {"status": st, "user": user_min(other, me_user)}


@api_view(["GET"])
def friends(request):
    u = request.user
    qs = Friendship.objects.filter(Q(requester=u) | Q(addressee=u)).select_related("requester", "addressee")
    hidden = blocked_ids(u)
    rows = [friend_row(f, u) for f in qs]
    return Response([r for r in rows if r["user"]["id"] not in hidden])


@api_view(["GET"])
def friend_suggestions(request):
    """People you may know: mutual friends first, then shared interests, then people who follow you."""
    u = request.user
    hidden = blocked_ids(u)
    rels = list(Friendship.objects.filter(Q(requester=u) | Q(addressee=u)))
    other = lambda f, me: f.addressee_id if f.requester_id == me else f.requester_id
    related = {other(f, u.id) for f in rels}                          # friends and pending requests, either way
    my_friends = {other(f, u.id) for f in rels if f.status == "accepted"}
    following = set(Follow.objects.filter(follower=u).values_list("target_id", flat=True))   # already followed (or requested)
    skip = related | following | hidden | {u.id}
    mutual = {}
    if my_friends:
        qs = Friendship.objects.filter(status="accepted").filter(Q(requester_id__in=my_friends) | Q(addressee_id__in=my_friends))
        for f in qs:
            for a, b in ((f.requester_id, f.addressee_id), (f.addressee_id, f.requester_id)):
                if a in my_friends and b not in skip:
                    mutual[b] = mutual.get(b, 0) + 1
    followers = set(Follow.objects.filter(target=u, status="accepted").values_list("follower_id", flat=True))
    mine = set(u.interests or [])
    rows = []
    for c in User.objects.exclude(pk__in=skip).order_by("-date_joined")[:300]:
        shared = [i for i in (c.interests or []) if i in mine]
        n = mutual.get(c.id, 0)
        if n:
            reason = f"{n} mutual OPAL{'S' if n > 1 else ''}"
        elif shared:
            reason = "Also likes " + ", ".join(utils.category_name(i) for i in shared[:2])
        elif c.id in followers:
            reason = "Follows you"
        else:
            reason = "On OPIOW"
        score = n * 10 + len(shared) * 3 + (5 if c.id in followers else 0)
        rows.append((score, {"user": user_min(c, u), "reason": reason, "mutual": n,
                             "interests": [{"id": i, "name": utils.category_name(i), "shared": i in mine} for i in (c.interests or [])[:MAX_INTERESTS]]}))
    rows.sort(key=lambda r: -r[0])           # stable: equal scores keep newest first
    return Response([r for _, r in rows[:10]])


@api_view(["POST"])
def friend_request(request):
    u = request.user
    t = user_or_404(pk=request.data.get("user_id")) if request.data.get("user_id") else user_or_404(username=(request.data.get("username") or "").lstrip("@").lower())
    if t.id == u.id:
        return bad("That is you.")
    if t.id in blocked_ids(u):
        return bad("You can't add this user.")
    f = Friendship.between(u, t)
    if not (f and f.status == "accepted") and not mutual_follow(u, t):
        return bad("You become OPALS when you follow each other. Follow them and ask them to follow you back.")
    if f:
        if f.status == "pending" and f.addressee_id == u.id:
            f.status = "accepted"
            f.save()
            return Response(friend_row(f, u))
        return bad("Already OPALS." if f.status == "accepted" else "Request already sent.")
    f = Friendship.objects.create(requester=u, addressee=t)
    return Response(friend_row(f, u), status=201)


@api_view(["POST", "DELETE"])
def friend_detail(request, uid):
    u = request.user
    t = user_or_404(pk=uid)
    f = Friendship.between(u, t)
    if not f:
        raise NotFound("No such friendship")
    if request.method == "POST":   # accept
        if f.addressee_id != u.id:
            return bad("Nothing to accept.")
        if not mutual_follow(u, t):
            return bad("You become OPALS when you follow each other. Follow them and ask them to follow you back.")
        f.status = "accepted"
        f.save()
        return Response(friend_row(f, u))
    f.delete()
    return Response(status=204)


def message_dict(m, viewer=None):
    d = {"id": m.id, "kind": m.kind, "from": m.sender_id, "url": m.url, "title": m.title, "image": m.image,
         "note": m.note, "created": m.created.isoformat()}
    if m.kind == "qr":                   # the text of a QR message reaches the person it was sent to only when they open it (once)
        d["opened"] = m.opened
        d["private"] = m.destroy_on_view
        if viewer is not None and m.recipient_id == viewer.id:
            d["note"] = ""
    if m.reply_to_id:                       # what it answers (a QR message never shows its words here)
        r = m.reply_to
        d["reply"] = {"id": r.id, "from": r.sender_id, "kind": r.kind, "title": "QR message" if r.kind == "qr" else ("Board invite" if r.kind == "board_invite" else r.title)}
    if m.invite_id:
        d["invite"] = {"id": m.invite_id, "status": m.invite.status, "board_id": m.invite.board_id, "role": m.invite.role}
    return d


def expire_messages(u):
    """Messages older than my auto-delete setting go from my side of every chat (the other person keeps theirs, as with any delete)."""
    any_set = False
    for kind, message_kind in AUTO_DELETE_KINDS.items():          # links, QR codes and boards each have their own time (or the general one)
        days = (u.auto_delete or {}).get(kind, u.auto_delete_days)
        if not days:
            continue
        any_set = True
        cutoff = timezone.now() - timedelta(days=days)
        Message.objects.filter(kind=message_kind, sender=u, created__lt=cutoff, sender_deleted=False).update(sender_deleted=True)
        Message.objects.filter(kind=message_kind, recipient=u, created__lt=cutoff, recipient_deleted=False).update(recipient_deleted=True)
    if any_set:
        Message.objects.filter(sender_deleted=True, recipient_deleted=True).filter(Q(sender=u) | Q(recipient=u)).delete()


def visible_messages(u, other):
    """Messages between u and other that u hasn't deleted (a sender never sees their own board invites)."""
    both = Q(sender=u, recipient=other, sender_deleted=False) | Q(sender=other, recipient=u, recipient_deleted=False)
    return Message.objects.filter(both).exclude(kind="board_invite", sender=u)


@api_view(["GET"])
def conversations(request):
    u = request.user
    expire_messages(u)
    hidden = blocked_ids(u)
    fr = Friendship.objects.filter(Q(requester=u) | Q(addressee=u), status="accepted").select_related("requester", "addressee")
    locks = set(Lock.objects.filter(user=u, kind="chat").values_list("target", flat=True))
    unread_by = dict(Message.objects.filter(recipient=u, read=False, recipient_deleted=False)
                     .values_list("sender_id").annotate(n=Count("id")))
    people = {}
    for f in fr:                                   # friends, plus anyone I have messages with (they may not be friends)
        other = f.addressee if f.requester_id == u.id else f.requester
        people[other.id] = other
    friend_ids = set(people)
    # one grouped query finds who I talk to and the newest message of each chat (instead of loading every message and querying per person)
    talked = Message.objects.filter(Q(sender=u, sender_deleted=False) | Q(recipient=u, recipient_deleted=False)).exclude(kind="board_invite", sender=u)
    last_id = {}
    for sid, rid, mid in talked.values_list("sender_id", "recipient_id").annotate(last=Max("id")).values_list("sender_id", "recipient_id", "last"):
        oid = rid if sid == u.id else sid
        last_id[oid] = max(last_id.get(oid, 0), mid)
    missing = [i for i in last_id if i not in people]
    if missing:
        people.update({o.id: o for o in User.objects.filter(pk__in=missing)})
    last_by = {m.sender_id if m.recipient_id == u.id else m.recipient_id: m
               for m in Message.objects.filter(pk__in=last_id.values()).select_related("invite", "reply_to")}
    with_ = str(request.GET.get("with", "")).strip().lstrip("@")           # a chat opens by number or, in the address bar, by the person's username
    want = (User.objects.filter(pk=with_).first() if with_.isdigit() else User.objects.filter(username__iexact=with_).first()) if with_ else None
    if want and want.id not in people and can_message(u, want):
        people[want.id] = want                     # opening a brand-new chat with someone who accepts your messages
    out = []
    for other in people.values():
        if other.id in hidden:
            continue
        last = last_by.get(other.id)
        is_fr = other.id in friend_ids
        if not is_fr and not last and not (want and other.id == want.id):
            continue
        locked = str(other.id) in locks
        unread = unread_by.get(other.id, 0)
        out.append({"user": user_min(other, u), "locked": locked, "last": None if (locked or not last) else message_dict(last, u),
                    "last_at": last.created.isoformat() if last else None, "unread": unread})
    out.sort(key=lambda r: r["last_at"] or "", reverse=True)
    return Response(out)


def own_site_url(request, raw):
    """The address of a real public board (/boards/<owner>/<name>) or card (/<name>/ocard) on this very site, else None.
    These are valid links even where the site has no dotted domain (local development)."""
    from urllib.parse import urlparse
    try:
        p = urlparse(str(raw or "").strip())
    except ValueError:
        return None
    site = urlparse(request.META.get("HTTP_ORIGIN") or request.META.get("HTTP_REFERER") or "")
    if p.scheme not in ("http", "https") or not site.netloc or p.netloc != site.netloc:
        return None
    parts = [x for x in p.path.split("/") if x]
    if len(parts) == 3 and parts[0] == "boards":
        ok = Board.objects.filter(owner__username__iexact=parts[1], slug=parts[2].lower(), is_public=True).exists()
    elif len(parts) == 2 and parts[1] == "ocard":
        ok = LinkPage.objects.filter(handle=parts[0].lower()).exists()
    else:
        ok = False
    return f"{p.scheme}://{p.netloc}{p.path}" if ok else None


@api_view(["GET", "POST"])
def messages(request, uid):
    u = request.user
    other = user_or_404(pk=uid)
    if other.id in blocked_ids(u):
        raise PermissionDenied("You can't message this user.")
    if request.method == "POST":
        if not can_message(u, other):
            raise PermissionDenied("This person isn't accepting messages from you.")
    elif not (is_friend(u, other) or can_message(u, other) or visible_messages(u, other).exists()):
        raise PermissionDenied("This person isn't accepting messages from you.")
    require_unlocked(request, "chat", other.id)
    if request.method == "GET":
        expire_messages(u)
    if request.method == "POST":
        reply_to = visible_messages(u, other).filter(pk=request.data.get("reply_to")).first() if str(request.data.get("reply_to") or "").isdigit() else None     # a reply to one message in this chat
        qr_text =" ".join(str(request.data.get("qr_text") or "").split()) if "qr_text" in request.data else None
        if qr_text is not None:        # a message sent as a QR code: the other person taps it to read it and reply
            if not qr_text:
                return bad("Type your message first.")
            if not other.qr_messages:
                raise PermissionDenied("This person doesn't accept QR messages.")
            if len(qr_text.split()) > QR_MAX_WORDS:
                return bad(f"A QR message can be up to {QR_MAX_WORDS} words.")
            m = Message.objects.create(sender=u, recipient=other, kind="qr", title="QR message", note=qr_text[:1500], destroy_on_view=bool(request.data.get("private", u.qr_private)), reply_to=reply_to)
            return Response(message_dict(m, u), status=201)
        url = own_site_url(request, request.data.get("url")) or utils.normalize_url(request.data.get("url"))
        if not url:
            return bad("Paste a valid link.")
        on_site = url == own_site_url(request, url)          # a board or card of this site, sent from the +
        given_title = " ".join(str(request.data.get("title") or "").split())[:300]       # a board or card sent from the + brings its own name and picture
        given_image = str(request.data.get("image") or "")
        given_image = given_image if given_title and given_image[:4] == "http" and len(given_image) < 1000 else ""
        meta = {"title": given_title, "image": given_image} if given_title else utils.fetch_meta(url)
        m = Message.objects.create(sender=u, recipient=other, url=url, title=(meta.get("title") or utils.pretty_host(utils.host_of(url)))[:300],
                                   image=meta.get("image") or ("" if on_site else utils.screenshot_url(url)), note=(request.data.get("note") or "")[:300], reply_to=reply_to)
        return Response(message_dict(m, u), status=201)
    Message.objects.filter(sender=other, recipient=u, read=False).update(read=True)
    return Response([message_dict(m, u) for m in visible_messages(u, other).select_related("invite", "reply_to")])


@api_view(["POST"])
def message_open(request, uid, mid):
    """The person a QR message was sent to opens it: they get the text once, then it is closed for good."""
    u = request.user
    other = user_or_404(pk=uid)
    require_unlocked(request, "chat", other.id)
    m = Message.objects.filter(pk=mid, kind="qr", sender=other, recipient=u, recipient_deleted=False).first()
    if not m:
        raise NotFound("Message not found")
    if m.opened:
        return bad("This message has already been opened.", 410)
    if m.destroy_on_view:                # a private message: they get the words now, and it is gone for both people
        mid_, note = m.id, m.note
        m.delete()
        return Response({"id": mid_, "note": note, "gone": True})
    m.opened = True
    m.read = True
    m.save(update_fields=["opened", "read"])
    return Response({"id": m.id, "note": m.note, "gone": False})


@api_view(["DELETE"])
def message_detail(request, uid, mid):
    """Delete a message from my side of the chat only; the other person keeps their copy."""
    u = request.user
    other = user_or_404(pk=uid)
    require_unlocked(request, "chat", other.id)
    m = Message.objects.filter(pk=mid).filter(Q(sender=u, recipient=other) | Q(sender=other, recipient=u)).first()
    if not m:
        raise NotFound("Message not found")
    if request.GET.get("all") == "1":      # delete for everyone: only the sender can, and it is gone from both chats
        if m.sender_id != u.id:
            raise PermissionDenied("Only the sender can delete a message for everyone.")
        m.delete()
        return Response(status=204)
    if m.sender_id == u.id:
        m.sender_deleted = True
    else:
        m.recipient_deleted = True
    if m.sender_deleted and m.recipient_deleted:
        m.delete()
    else:
        m.save(update_fields=["sender_deleted", "recipient_deleted"])
    return Response(status=204)


@api_view(["GET"])
def inbox_counts(request):
    """Badge numbers for the Inbox tab. The app calls this every few seconds while open, so it doubles as the online heartbeat."""
    u = request.user
    touch_presence(u)
    hidden = blocked_ids(u)
    friend_ids = {f.addressee_id if f.requester_id == u.id else f.requester_id
                  for f in Friendship.objects.filter(Q(requester=u) | Q(addressee=u), status="accepted")}
    unread = Message.objects.filter(recipient=u, read=False, recipient_deleted=False, sender_id__in=friend_ids - hidden).count()
    requests = Friendship.objects.filter(addressee=u, status="pending").exclude(requester_id__in=hidden).count()
    return Response({"messages": unread, "requests": requests, "followers": new_follower_count(u, hidden)})


def new_follower_count(u, hidden=None):
    """New followers not yet looked at, plus follow requests waiting for approval (one query)."""
    hidden = blocked_ids(u) if hidden is None else hidden
    qs = Follow.objects.filter(target=u).exclude(follower_id__in=hidden)
    n = qs.aggregate(new=Count("id", filter=Q(status="accepted", seen=False)), pending=Count("id", filter=Q(status="pending")))
    return n["new"] + n["pending"]


@api_view(["POST"])
def nickname(request, uid):
    t = user_or_404(pk=uid)
    nick = (request.data.get("nickname") or "").strip()[:30]
    n = dict(request.user.nicknames or {})
    if nick:
        n[str(t.id)] = nick
    else:
        n.pop(str(t.id), None)
    request.user.nicknames = n
    request.user.save(update_fields=["nicknames"])
    return Response({"nicknames": n})


# ----------------------------------------------------------------- blocks
@api_view(["GET", "POST"])
def blocks(request):
    u = request.user
    if request.method == "POST":
        t = user_or_404(pk=request.data.get("user_id"))
        if t.id == u.id:
            return bad("You can't block yourself.")
        Block.objects.get_or_create(blocker=u, blocked=t)
        Follow.objects.filter(Q(follower=u, target=t) | Q(follower=t, target=u)).delete()
        return Response({"ok": True}, status=201)
    return Response([user_min(b.blocked, u) for b in Block.objects.filter(blocker=u).select_related("blocked")])


@api_view(["DELETE"])
def unblock(request, uid):
    Block.objects.filter(blocker=request.user, blocked_id=uid).delete()
    return Response(status=204)


# ----------------------------------------------------------------- locks (PIN for chats and boards)
@api_view(["GET", "POST", "DELETE"])
def locks(request):
    u = request.user
    if request.method == "GET":
        return Response([{"kind": l.kind, "target": l.target} for l in Lock.objects.filter(user=u)])
    kind, target, pin = request.data.get("kind"), str(request.data.get("target") or ""), str(request.data.get("pin") or "")
    if kind not in ("chat", "board") or not target:
        return bad("Invalid lock.")
    if request.method == "POST":
        if not (pin.isdigit() and len(pin) == 4):
            return bad("Use exactly 4 digits.")
        Lock.objects.update_or_create(user=u, kind=kind, target=target, defaults={"pin_hash": make_password(pin)})
        return Response({"token": sign_unlock(u, kind, target)}, status=201)
    lock = Lock.objects.filter(user=u, kind=kind, target=target).first()
    if lock and not check_password(pin, lock.pin_hash):
        return bad("Wrong PIN.")
    Lock.objects.filter(user=u, kind=kind, target=target).delete()
    return Response(status=204)


@api_view(["POST"])
def lock_verify(request):
    u = request.user
    kind, target, pin = request.data.get("kind"), str(request.data.get("target") or ""), str(request.data.get("pin") or "")
    lock = Lock.objects.filter(user=u, kind=kind, target=target).first()
    if not lock:
        return Response({"token": sign_unlock(u, kind, target)})
    if not check_password(pin, lock.pin_hash):
        return bad("Wrong PIN.")
    return Response({"token": sign_unlock(u, kind, target)})


@api_view(["GET"])
def invites(request):
    qs = BoardInvite.objects.filter(to_user=request.user, status="pending").select_related("board", "from_user")
    return Response([{"id": i.id, "board_id": i.board_id, "board": i.board.name, "from": user_min(i.from_user, request.user)} for i in qs])


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"ok": True})


# ----------------------------------------------------------------- shortlinks
SHORT_ALIAS_RX = re.compile(r"^[a-z0-9][a-z0-9_-]{2,29}$")
MAX_SHORTLINKS = 100


def short_dict(s, request=None):
    return {"id": s.id, "code": s.code, "url": s.url, "clicks": s.clicks, "created": s.created.isoformat()}


@api_view(["GET", "POST"])
def shortlinks(request):
    """My short links (GET), or make one (POST {url, alias?}). The alias is optional: without one a short random code is used."""
    u = request.user
    if request.method == "GET":
        return Response([short_dict(s) for s in u.shortlinks.all()])
    url = utils.normalize_url(request.data.get("url"))
    if not url or len(url) > 2000:
        return bad("Paste a valid link to shorten.")
    if re.search(r"/s/[A-Za-z0-9_-]+/?$", url) and url.split("/")[2] == (request.META.get("HTTP_HOST") or ""):
        return bad("That is already a short link.")
    if u.shortlinks.count() >= MAX_SHORTLINKS:
        return bad(f"You can have up to {MAX_SHORTLINKS} short links. Delete one to make another.")
    alias = (request.data.get("alias") or "").strip().lower()
    if alias:
        if not SHORT_ALIAS_RX.match(alias):
            return bad("Use 3 to 30 letters, numbers, - or _ for the short name.")
        if ShortLink.objects.filter(code=alias).exists():
            return bad("That short name is taken. Try another.")
        code = alias
    else:
        import secrets
        alphabet = "abcdefghijkmnpqrstuvwxyz23456789"          # no look-alike letters (l, o, 0, 1)
        for _ in range(20):
            code = "".join(secrets.choice(alphabet) for _ in range(6))
            if not ShortLink.objects.filter(code=code).exists():
                break
        else:
            return bad("Could not make a short link. Try again.")
    s = ShortLink.objects.create(owner=u, code=code, url=url)
    return Response(short_dict(s), status=201)


@api_view(["DELETE"])
def shortlink_detail(request, pk):
    s = request.user.shortlinks.filter(pk=pk).first()
    if not s:
        raise NotFound("Short link not found")
    s.delete()
    return Response(status=204)


@api_view(["GET"])
@permission_classes([AllowAny])
def shortlink_open(request, code):
    """Where a short link goes. The page at /s/<code> asks this and then sends the visitor on; every use is counted."""
    from django.db.models import F
    s = ShortLink.objects.filter(code=code.lower()).first()
    if not s:
        raise NotFound("This short link doesn't exist.")
    if not (request.user.is_authenticated and request.user.id == s.owner_id):      # the owner opening their own link is not a click
        ShortLink.objects.filter(pk=s.pk).update(clicks=F("clicks") + 1)
    return Response({"url": s.url})
