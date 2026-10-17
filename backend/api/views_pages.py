"""Cards: each person can publish one shareable page with a banner, picture, short description and up to 16 links.
The first tab holds every link (it can be renamed or hidden); up to 3 more tabs can each show up to 6 of them."""
import re
import uuid
from datetime import timedelta
from django.db.models import Q
from django.utils import timezone
from urllib.parse import urlparse
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .helpers import blocked_ids, clean_photo, user_min
from .models import Activity, Board, BoardSave, Friendship, Link, LinkPage

MAX_WORDS = 28
MAX_TABS = 4         # tabs on a card, the first one included (Pro: PRO_TABS, kept the same while upgrades are off)
PRO_TABS = 4
MAX_TAB_WORDS = 14   # words in a tab's optional description
MAX_SOCIALS = 8      # icon-only social links under a card's description
SOCIAL_KEYS = {"instagram", "facebook", "x", "youtube", "tiktok", "linkedin", "whatsapp", "telegram", "snapchat", "github", "pinterest", "threads", "discord", "twitch", "spotify", "reddit"}
MAX_LINK_WORDS = 12  # words in a link's optional description (shown when the link is a preview card)
COVER_PRESETS = {"sunset", "ocean", "forest", "berry", "gold", "night", "mint"}      # the ready-made preview pictures
STATUS_MAX_DAYS = 30
STATUS_MAX = 10       # links and boards in a card's status
FEED_DAYS = 7         # an OPAL's status shows what they created in the last 7 days (their latest 10 links and boards)
MAX_TAB_NAME = 12    # letters in a tab name
MAX_LINKS = 6        # per extra tab
MAX_TOTAL = 30       # links on a card (Pro: PRO_TOTAL, kept the same while upgrades are off)
PRO_TOTAL = 30
MAX_CARDS = 3        # cards per person on a free account (Pro: PRO_CARDS)
PRO_CARDS = 10
HANDLE_RX = re.compile(r"^[a-z0-9_-]{3,30}$")
# a card lives at /<name>/ocard, so a name must not be one of the app's own pages
RESERVED = {"ocard", "l", "api", "admin", "media", "login", "signup", "discover", "mine", "malinks", "oguide", "ogems", "otin", "s", "shortlink", "friends", "saved", "boards", "inbox", "analytics", "settings", "u", "mylinks"}
USERNAME_RX = re.compile(r"^[a-z0-9_]{3,20}$")
ICON_RX = re.compile(r"^[a-z0-9_:-]{1,30}$")      # a built-in icon key (or an uploaded picture, which is a data URL)


def limits(u):
    """What this account may have: cards, extra tabs per card (plus the first tab that holds every link)."""
    return {"pro": u.is_pro, "cards": PRO_CARDS if u.is_pro else MAX_CARDS, "tabs": PRO_TABS if u.is_pro else MAX_TABS,
            "links": PRO_TOTAL if u.is_pro else MAX_TOTAL}


def bad(msg):
    return Response({"detail": msg}, status=400)


def clean_cover(raw):
    """A link's preview picture: empty (picked from the link itself), one of the ready-made ones ("preset:sunset"), a picture address or an uploaded picture."""
    cover = (raw or "").strip() if isinstance(raw, str) else ""
    if not cover:
        return "", None
    if cover.startswith("preset:"):
        return (cover, None) if cover[7:] in COVER_PRESETS else ("", None)
    if cover.startswith("data:image/"):
        try:
            cover = clean_photo(cover)
        except ValueError as e:
            return "", str(e)
        return (cover, None) if len(cover) <= 150_000 else ("", "That preview picture is too large.")
    if cover.startswith(("http://", "https://")) and len(cover) <= 500:
        return cover, None
    return "", None


def clean_socials(raw):
    """The icon-only links under a card's description: a site from the top list (one each) or the person's own icon picture, each with the address pasted for it.
    Returns (list, error or None)."""
    if not isinstance(raw, list):
        return [], None
    if len(raw) > MAX_SOCIALS:
        return [], f"A card can hold up to {MAX_SOCIALS} social icons."
    out, seen = [], set()
    for s in raw:
        if not isinstance(s, dict):
            continue
        kind, url = str(s.get("kind") or "").strip().lower(), (s.get("url") or "").strip()[:500]
        if kind != "custom" and (kind not in SOCIAL_KEYS or kind in seen):
            continue
        if not url:
            return [], "Paste the link for every social icon, or remove it."
        if not re.match(r"^https?://", url, re.I):
            url = "https://" + url
        try:
            URLValidator(schemes=["http", "https"])(url)
        except ValidationError:
            return [], f"“{url}” is not a valid web address."
        if kind == "custom":          # the person's own icon: a small picture and a link
            image = (s.get("image") or "").strip()
            if not image.startswith("data:image/") or len(image) > 60_000:
                return [], "Add a small picture for your own icon."
            try:
                image = clean_photo(image)
            except ValueError as e:
                return [], str(e)
            cid = str(s.get("id") or "")[:20]
            if not cid or cid in seen:
                cid = uuid.uuid4().hex[:10]
            seen.add(cid)
            out.append({"kind": "custom", "id": cid, "image": image, "url": url})
            continue
        seen.add(kind)
        out.append({"kind": kind, "url": url})
    return out, None


def clean_items(raw, max_links):
    """Returns (items, error message or None)."""
    if not isinstance(raw, list):
        return [], None
    if len(raw) > max_links:
        return [], f"A card can hold up to {max_links} links." + ("" if max_links >= PRO_TOTAL else " Upgrade to add more.")
    items, seen = [], set()
    for it in raw:
        name = (it.get("name") or "").strip()[:40]
        url = (it.get("url") or "").strip()[:500]
        if not url:
            return [], "Every link needs a web address."
        if not re.match(r"^https?://", url, re.I):
            url = "https://" + url
        try:
            URLValidator(schemes=["http", "https"])(url)
        except ValidationError:
            return [], f"â€œ{url}â€ is not a valid web address."
        if not name:      # the name is optional: the site's own address stands in for it
            name = (urlparse(url).hostname or url).removeprefix("www.")[:40]
        icon = (it.get("icon") or "").strip()
        if icon.startswith("data:image/"):
            try:
                icon = clean_photo(icon)
            except ValueError as e:
                return [], str(e)
            if len(icon) > 60_000:
                return [], "That icon picture is too large."
        elif icon.startswith(("http://", "https://")) and len(icon) <= 500:
            pass                                  # a picture address, e.g. a board's photo
        elif icon and not ICON_RX.match(icon):
            icon = ""
        iid = str(it.get("id") or "")[:20]
        if not iid or iid in seen:
            iid = uuid.uuid4().hex[:10]
        seen.add(iid)
        desc = " ".join(str(it.get("desc") or "").split())
        if len(desc.split()) > MAX_LINK_WORDS:
            return [], f"Keep a link's description to {MAX_LINK_WORDS} words or fewer."
        cover, err = clean_cover(it.get("cover"))
        if err:
            return [], err
        items.append({"id": iid, "name": name, "url": url, "icon": icon, "adult": bool(it.get("adult")), "desc": desc[:160], "preview": bool(it.get("preview")), "cover": cover})
    return items, None


def status_expiry(page):
    """When the status runs out (None when there is no status or no start time)."""
    if not page.status or not page.status_at:
        return None
    return page.status_at + timedelta(days=page.status_days)


def live_status(page):
    """The status, or nothing once its days are over."""
    exp = status_expiry(page)
    if page.status and exp and exp < timezone.now():
        return []
    return page.status or []


def my_status_out(u):
    return {"status": live_status(u), "status_days": u.status_days, "status_expires": status_expiry(u), "max": STATUS_MAX, "max_days": STATUS_MAX_DAYS}


@api_view(["GET", "PUT"])
def my_status(request):
    """My OPALS status, set up like a card's: up to 10 links and boards that stay for 1 to 30 days after the last change."""
    u = request.user
    if request.method == "PUT":
        d = request.data
        status, err = clean_status(d.get("status", []), u)
        if err:
            return bad(err)
        try:
            days = int(d.get("status_days", u.status_days))
        except (TypeError, ValueError):
            return bad("Choose 1 to 30 days.")
        if not 1 <= days <= STATUS_MAX_DAYS:
            return bad(f"A status lasts from 1 to {STATUS_MAX_DAYS} days.")
        if status != (u.status or []) or days != u.status_days:
            u.status, u.status_days, u.status_at = status, days, timezone.now()          # the days count from the last change
            u.save(update_fields=["status", "status_days", "status_at"])
    return Response(my_status_out(u))


@api_view(["GET"])
def status_feed(request):
    """The statuses of my OPALS (friends) that are still running, newest change first."""
    u = request.user
    hidden = blocked_ids(u)
    since = timezone.now() - timedelta(days=FEED_DAYS)
    friends = []
    for f in Friendship.objects.filter(Q(requester=u) | Q(addressee=u), status="accepted").select_related("requester", "addressee"):
        other = f.addressee if f.requester_id == u.id else f.requester
        if other.id not in hidden:
            friends.append(other)
    ids = [o.id for o in friends]
    links = Link.objects.filter(owner_id__in=ids, source="mine", is_public=True, created__gte=since).exclude(category__in=u.blocked_categories)
    if u.hide_adult:
        links = links.exclude(adult=True)
    boards = Board.objects.filter(owner_id__in=ids, is_public=True, created__gte=since).select_related("owner")
    made = {i: [] for i in ids}                  # what each OPAL created lately: (when, entry)
    for l in links.order_by("-created"):
        image = l.image if not l.image.startswith("data:") or len(l.image) < 60_000 else ""
        made[l.owner_id].append((l.created, {"id": f"l{l.id}", "kind": "link", "ref": l.id, "title": l.title[:120], "url": l.url, "image": image, "host": l.host}))
    for b in boards.order_by("-created"):
        image = b.image or (b.links.exclude(image="").values_list("image", flat=True).first() or "")
        if image.startswith("data:") and len(image) > 60_000:
            image = ""
        made[b.owner_id].append((b.created, {"id": f"b{b.id}", "kind": "board", "ref": b.id, "title": b.name[:120], "url": f"/boards/{b.owner.username}/{b.slug}", "image": image, "host": ""}))
    out = []
    for other in friends:
        mine = sorted(made[other.id], key=lambda x: x[0], reverse=True)[:STATUS_MAX]      # their latest 10 links and boards
        if mine:
            out.append({"owner": user_min(other, u), "status": [e for _, e in mine], "at": mine[0][0].isoformat()})
    out.sort(key=lambda r: r["at"], reverse=True)
    return Response(out)                       # never includes me: you only see your OPALS' status


def clean_status(raw, user):
    """The status of a card: [{"kind": "link"|"board", "ref_id": n}] -> stored with what is needed to show it. Returns (items, error)."""
    if not isinstance(raw, list):
        return [], None
    items, seen = [], set()
    for r in raw:
        kind, ref = r.get("kind"), r.get("ref_id", r.get("ref"))
        if (kind, ref) in seen:
            continue
        seen.add((kind, ref))
        if kind == "link":
            l = Link.objects.filter(pk=ref).filter(Q(owner=user) | Q(source="mine", is_public=True)).first()       # one of your own links (Mine or Saved), or anyone's public link
            if not l:
                return [], "That link is not one of yours, or not public."
            image = l.image if not l.image.startswith("data:") or len(l.image) < 60_000 else ""
            items.append({"id": f"l{l.id}", "kind": "link", "ref": l.id, "title": l.title[:120], "url": l.url, "image": image, "host": l.host})
        elif kind == "board":
            b = Board.objects.filter(pk=ref).select_related("owner").first()
            if not b or not b.is_public:
                return [], "Only a public board can go in a status."
            image = b.image or (b.links.exclude(image="").values_list("image", flat=True).first() or "")
            if image.startswith("data:") and len(image) > 60_000:
                image = ""
            items.append({"id": f"b{b.id}", "kind": "board", "ref": b.id, "title": b.name[:120], "url": f"/boards/{b.owner.username}/{b.slug}", "image": image, "host": ""})
        else:
            return [], "A status holds links and boards."
        if len(items) > STATUS_MAX:
            return [], f"A status can hold up to {STATUS_MAX} links and boards."
    return items, None


def page_out(page, hide_empty):
    """The card with its tabs in order. The first tab (holding every link) sits at `main_pos`. Visitors (hide_empty) never get hidden or empty tabs."""
    by_id = {i["id"]: i for i in page.items or []}
    tabs = []
    for t in page.tabs or []:
        ids = [i for i in t.get("item_ids", []) if i in by_id]
        tabs.append({"main": False, "name": t.get("name", ""), "icon": "", "desc": t.get("desc", ""), "desc_below": bool(t.get("desc_below")), "hidden": bool(t.get("hidden")), "item_ids": ids, "items": [by_id[i] for i in ids]})
    main = {"main": True, "name": page.main_name or "My Card", "icon": "", "desc": page.main_desc, "desc_below": page.main_desc_below, "hidden": page.main_hidden, "item_ids": list(by_id), "items": list(by_id.values())}
    tabs.insert(max(0, min(page.main_pos, len(tabs))), main)
    if hide_empty:
        tabs = [t for t in tabs if t["items"] and not t["hidden"]]
    return {"id": page.id, "name": page.name or page.user.display(), "handle": page.handle, "bio": page.bio, "socials": page.socials or [], "link_view": page.link_view or "small", "banner": page.banner, "background": page.background,
            "items": page.items or [], "adult": page.adult or any(i.get("adult") for i in page.items or []), "adult_card": page.adult, "main_name": page.main_name, "main_hidden": page.main_hidden, "on_profile": page.on_profile, "status": live_status(page), "status_days": page.status_days, "status_expires": status_expiry(page), "tabs": tabs}


@api_view(["GET", "PUT"])
def my_pages(request):
    """GET: all my cards. PUT: save one (send its `id`), or create a new one (no id) while I have fewer than 3."""
    u = request.user
    if request.method == "GET":
        return Response({"pages": [page_out(p, hide_empty=False) for p in u.cards.order_by("id")], "max": limits(u)["cards"], "limits": limits(u)})
    d = request.data
    page = None
    if d.get("id") is not None:
        page = u.cards.filter(pk=d.get("id")).first()
        if not page:
            return Response({"detail": "Card not found"}, status=404)
    elif u.cards.count() >= limits(u)["cards"]:
        return bad(f"You can have up to {limits(u)['cards']} cards. Upgrade to add more." if not u.is_pro else f"You can have up to {limits(u)['cards']} cards.")
    handle = (d.get("handle") or "").strip().lower()
    if not HANDLE_RX.match(handle):
        return bad("Choose a name of 3 to 30 letters, numbers, - or _.")
    if handle in RESERVED:
        return bad("That name is not available.")
    if LinkPage.objects.filter(handle=handle).exclude(pk=page.pk if page else None).exists():
        return bad("That name is already taken.")
    bio = " ".join((d.get("bio") or "").split())
    if len(bio.split()) > MAX_WORDS:
        return bad(f"Keep the description to {MAX_WORDS} words or fewer.")
    lim = limits(u)
    items, err = clean_items(d.get("items"), lim["links"])
    if err:
        return bad(err)
    socials, err = clean_socials(d.get("socials"))
    if err:
        return bad(err)
    ids = {i["id"] for i in items}
    tabs = []
    extra = d.get("tabs") or []
    for t in extra[:lim["tabs"] - 1]:
        name = (t.get("name") or "").strip()[:MAX_TAB_NAME]
        if not name:
            continue
        picked = [i for i in (t.get("item_ids") or []) if i in ids]
        if len(picked) > MAX_LINKS:
            return bad(f"A tab can hold up to {MAX_LINKS} links.")
        desc = " ".join((t.get("desc") or "").split())
        if len(desc.split()) > MAX_TAB_WORDS:
            return bad(f"Keep a tab's description to {MAX_TAB_WORDS} words or fewer.")
        tabs.append({"name": name, "desc": desc[:200], "desc_below": bool(t.get("desc_below")), "item_ids": picked, "hidden": bool(t.get("hidden"))})
    extra = {}
    if "status" in d:
        status, err = clean_status(d["status"], u)
        if err:
            return bad(err)
        extra["status"] = status
    if "status_days" in d:
        try:
            days = int(d["status_days"])
        except (TypeError, ValueError):
            return bad("Choose 1 to 30 days.")
        if not 1 <= days <= STATUS_MAX_DAYS:
            return bad(f"A status lasts from 1 to {STATUS_MAX_DAYS} days.")
        extra["status_days"] = days
    if extra and (page is None or any(getattr(page, k) != v for k, v in extra.items())):
        extra["status_at"] = timezone.now()           # the days count from the last change
    pics = {}
    for k in ("banner", "background"):
        if k in d:
            try:
                pics[k] = clean_photo(d[k])
            except ValueError as e:
                return bad(str(e))
    main_name = (d.get("main_name") or "").strip()[:MAX_TAB_NAME] or "My Card"
    main_desc = " ".join((d.get("main_desc") or "").split())
    if len(main_desc.split()) > MAX_TAB_WORDS:
        return bad(f"Keep a tab's description to {MAX_TAB_WORDS} words or fewer.")
    try:
        main_pos = max(0, min(int(d.get("main_pos") or 0), len(tabs)))
    except (TypeError, ValueError):
        main_pos = 0
    fields = {"name": (d.get("name") or "").strip()[:40], "handle": handle, "bio": bio, "items": items, "tabs": tabs, "main_name": main_name, "main_hidden": bool(d.get("main_hidden")), "main_desc": main_desc[:200], "main_desc_below": bool(d.get("main_desc_below")), "socials": socials if "socials" in d else (page.socials if page else []), "link_view": ("large" if d.get("link_view") == "large" else "small") if "link_view" in d else (page.link_view if page else "small"),
              "main_pos": main_pos, "adult": bool(d.get("adult")), **pics, **extra}
    if page:
        for k, v in fields.items():
            setattr(page, k, v)
        page.save()
    else:
        page = LinkPage.objects.create(user=u, on_profile=not u.cards.filter(on_profile=True).exists(), **fields)   # the first card goes on the profile
    return Response({"page": page_out(page, hide_empty=False)})


@api_view(["PATCH", "DELETE"])
def my_page_detail(request, pk):
    """PATCH {on_profile: true} shows this card on my profile (only one at a time); false shows none. DELETE removes it."""
    u = request.user
    page = u.cards.filter(pk=pk).first()
    if not page:
        return Response(status=404)
    if request.method == "DELETE":
        page.delete()
        return Response(status=204)
    on = bool(request.data.get("on_profile"))
    if on:
        u.cards.exclude(pk=pk).update(on_profile=False)
    page.on_profile = on
    page.save(update_fields=["on_profile"])
    return Response({"pages": [page_out(p, hide_empty=False) for p in u.cards.order_by("id")], "max": limits(u)["cards"], "limits": limits(u)})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_page(request, handle):
    page = LinkPage.objects.select_related("user").filter(handle=handle.lower()).first()
    if not page:
        return Response({"detail": "Page not found"}, status=404)
    return Response({**page_out(page, hide_empty=True), "owner": user_min(page.user)})


@api_view(["POST"])
@permission_classes([AllowAny])
def card_event(request, handle):
    """Count something that happened on a card for its owner's Analytics: a view, a click on one of its links, or a share."""
    page = LinkPage.objects.filter(handle=handle.lower()).first()
    if not page:
        return Response({"detail": "Page not found"}, status=404)
    kind = request.data.get("kind")
    if kind not in ("view", "click", "share"):
        return bad("kind must be view, click or share")
    actor = request.user if request.user.is_authenticated else None
    if actor and actor.id == page.user_id:
        return Response(status=204)               # looking at your own card does not count
    item = str(request.data.get("item") or "")[:20]
    if kind == "click" and item not in {i["id"] for i in page.items or []}:
        return Response(status=204)
    Activity.objects.create(owner=page.user, actor=actor, kind=kind, card=page, item=item if kind == "click" else "")
    return Response(status=204)


@api_view(["GET"])
def card_stats(request, pk):
    """The owner's numbers for one card: views, clicks on its links and shares over a period (?days=1|7|30|90|365, 0 = all time),
    the most clicked links, and a per-day trend for the last 7 days."""
    from django.db.models import Count
    u = request.user
    page = u.cards.filter(pk=pk).first()
    if not page:
        return Response({"detail": "Card not found"}, status=404)
    try:
        days = int(request.GET.get("days", 0))
    except ValueError:
        days = 0
    days = days if days in (0, 1, 7, 30, 90, 180, 365) else 0
    acts = Activity.objects.filter(card=page)
    if days:
        acts = acts.filter(created__gte=timezone.now() - timedelta(days=days))
    counts = {r["kind"]: r["n"] for r in acts.values("kind").annotate(n=Count("id"))}
    names = {i["id"]: i.get("name") or i.get("url", "") for i in page.items or []}
    top = [{"name": names.get(r["item"], "(removed link)"), "clicks": r["n"]}
           for r in acts.filter(kind="click").values("item").annotate(n=Count("id")).order_by("-n")[:5]]
    today = timezone.localdate()
    per_day = {}
    for a in Activity.objects.filter(card=page, created__gte=timezone.now() - timedelta(days=7)):
        d = timezone.localtime(a.created).date()
        per_day.setdefault(d, {})[a.kind] = per_day.get(d, {}).get(a.kind, 0) + 1
    trend = []
    for k in range(6, -1, -1):
        d = today - timedelta(days=k)
        c = per_day.get(d, {})
        trend.append({"date": d.isoformat(), "view": c.get("view", 0), "click": c.get("click", 0), "share": c.get("share", 0)})
    return Response({"id": page.id, "name": page.name or page.handle, "handle": page.handle, "days": days,
                     "view": counts.get("view", 0), "click": counts.get("click", 0), "share": counts.get("share", 0),
                     "top": top, "trend": trend, "link_count": len(page.items or [])})


@api_view(["GET"])
@permission_classes([AllowAny])
def check_name(request):
    """Is a username (kind=username) or card page name (kind=page) free? Your own current name counts as free."""
    kind = request.query_params.get("kind")
    name = (request.query_params.get("name") or "").strip().lower().lstrip("@")
    me = request.user if request.user.is_authenticated else None
    card_id = request.query_params.get("id")       # the card being edited: its own name counts as free
    if kind == "username":
        if not USERNAME_RX.match(name):
            return Response({"available": False, "valid": False, "detail": "Use 3 to 20 letters, numbers or _."})
        taken = get_user_model().objects.filter(username__iexact=name).exclude(pk=me.pk if me else None).exists()
    elif kind == "page":
        if not HANDLE_RX.match(name):
            return Response({"available": False, "valid": False, "detail": "Use 3 to 30 letters, numbers, - or _."})
        if name in RESERVED:
            return Response({"available": False, "valid": False, "detail": "That name is not available."})
        taken = LinkPage.objects.filter(handle=name).exclude(pk=card_id if str(card_id).isdigit() else None).exists()
    else:
        return bad("kind must be username or page")
    return Response({"available": not taken, "valid": True, "detail": "Taken" if taken else "Available"})


@api_view(["POST"])
def upgrade(request):
    """Switch Pro on (more cards and tabs). Until payments are connected this is open to everyone; see PRO_SELF_UPGRADE in settings."""
    from django.conf import settings
    u = request.user
    if not u.is_pro:
        if not settings.PRO_SELF_UPGRADE:
            return Response({"detail": "Upgrades are not open yet."}, status=403)
        u.is_pro = True
        u.save(update_fields=["is_pro"])
    return Response({"is_pro": True, **limits(u)})
