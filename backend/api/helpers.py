from datetime import timedelta

from django.core import signing
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from .models import Block, Follow, Friendship, Lock

MAX_PHOTO = 900_000  # characters of data URL
ONLINE_WINDOW = timedelta(seconds=45)    # the open app pings every ~5s, so 45s of silence means offline


def blocked_ids(user):
    """Everyone the user blocked OR who blocked the user (both directions hide content)."""
    pairs = Block.objects.filter(Q(blocker=user) | Q(blocked=user)).values_list("blocker_id", "blocked_id")   # one query
    return {b if a == user.id else a for a, b in pairs}


def is_friend(a, b):
    f = Friendship.between(a, b)
    return bool(f and f.status == "accepted")


def mutual_follow(a, b):
    """Friends must follow each other (both follows accepted)."""
    return Follow.objects.filter(follower=a, target=b, status="accepted").exists() and         Follow.objects.filter(follower=b, target=a, status="accepted").exists()


def can_message(sender, recipient):
    """Recipient's setting decides: anyone / friends only / no one."""
    if sender.id == recipient.id or recipient.id in blocked_ids(sender):
        return False
    mode = "friends" if recipient.is_private else recipient.message_privacy
    return mode == "anyone" or (mode == "friends" and is_friend(sender, recipient))


def can_see_profile(viewer, target):
    if viewer.id == target.id:
        return True
    if target.id in blocked_ids(viewer):
        return False
    if not target.is_private:
        return True
    if Follow.objects.filter(follower=viewer, target=target, status="accepted").exists():
        return True
    return is_friend(viewer, target)


def touch_presence(user):
    """Record that the user has the app open. Writes at most every 15 seconds."""
    now = timezone.now()
    if not user.last_seen or now - user.last_seen > timedelta(seconds=15):
        type(user).objects.filter(pk=user.pk).update(last_seen=now)
        user.last_seen = now


def is_online(u):
    return bool(u.last_seen and timezone.now() - u.last_seen < ONLINE_WINDOW)


def user_min(u, viewer=None):
    nick = ""
    if viewer is not None:
        nick = (viewer.nicknames or {}).get(str(u.id), "")
    mine = viewer is not None and viewer.id == u.id          # you never see a dot on yourself
    return {"id": u.id, "username": u.username, "name": u.display(), "photo": u.photo, "nickname": nick,
            "online": False if mine else is_online(u)}


def link_dict(l, viewer=None):
    owner = l.owner
    saved_from = l.saved_from
    poster = saved_from if l.source == "saved" and saved_from else owner
    return {
        "id": l.id, "url": l.url, "host": l.host, "title": l.title, "description": l.description,
        "image": l.image, "logo": l.logo, "custom_image": l.custom_image, "category": l.category,
        "is_public": l.is_public, "adult": l.adult, "source": l.source,
        "advertised": l.advertised, "pitch": l.pitch, "created": l.created.isoformat(),
        "owner": user_min(poster, viewer) if (l.source == "saved" and saved_from) or (viewer and owner.id != viewer.id) else None,
    }


def board_link_dict(bl, viewer=None):
    return {
        "id": bl.id, "url": bl.url, "host": bl.host, "title": bl.title, "description": bl.description,
        "image": bl.image, "logo": bl.logo, "category": bl.category, "adult": bl.adult,
        "created": bl.created.isoformat(), "added_by": user_min(bl.added_by, viewer),
        "owner": user_min(bl.from_user, viewer) if bl.from_user else None,
        "board_link": True,
    }


def sign_unlock(user, kind, target):
    return signing.dumps({"u": user.id, "k": kind, "t": str(target)}, salt="opio-unlock")


def is_unlocked(request, kind, target):
    """A locked chat/board needs a signed token (from /locks/verify/) in the X-Unlock header."""
    if not Lock.objects.filter(user=request.user, kind=kind, target=str(target)).exists():
        return True
    for tok in (request.headers.get("X-Unlock") or "").split(","):
        try:
            d = signing.loads(tok.strip(), salt="opio-unlock", max_age=60 * 60)
        except signing.BadSignature:
            continue
        if d["u"] == request.user.id and d["k"] == kind and d["t"] == str(target):
            return True
    return False


def require_unlocked(request, kind, target):
    if not is_unlocked(request, kind, target):
        raise PermissionDenied({"detail": "locked", "locked": True})


def clean_photo(value):
    if value in (None, ""):
        return ""
    if not isinstance(value, str) or len(value) > MAX_PHOTO:
        raise ValueError("Photo is too large")
    if not (value.startswith("data:image/") or value.startswith("http") or value.startswith("/media/")):
        raise ValueError("Invalid photo")
    return value


REACTIONS = ["\u2764\ufe0f", "\U0001F525", "\U0001F602", "\U0001F44F", "\U0001F62E"]


def attach_reactions(rows, viewer):
    """Add {reactions: {emoji: n}, my_reaction} to link dicts (numeric ids only), in two queries for the whole list."""
    from django.db.models import Count
    from .models import BoardLinkReaction, Reaction
    authed = getattr(viewer, "is_authenticated", True)

    def board_id(d):
        """The BoardLink id of a link that sits on a board (Discover tags them 'b<id>'), else None."""
        i = d.get("id")
        if isinstance(i, str) and i[1:].isdigit() and i[0] == "b":
            return int(i[1:])
        return i if d.get("board_link") and isinstance(i, int) else None

    ids = [d["id"] for d in rows if isinstance(d.get("id"), int) and not d.get("board_link")]
    bids = [b for b in (board_id(d) for d in rows) if b is not None]
    counts, mine, bcounts, bmine = {}, {}, {}, {}
    if ids:
        for r in Reaction.objects.filter(link_id__in=ids).values("link_id", "emoji").annotate(n=Count("id")):
            counts.setdefault(r["link_id"], {})[r["emoji"]] = r["n"]
        mine = dict(Reaction.objects.filter(link_id__in=ids, user=viewer).values_list("link_id", "emoji")) if authed else {}
    if bids:
        for r in BoardLinkReaction.objects.filter(board_link_id__in=bids).values("board_link_id", "emoji").annotate(n=Count("id")):
            bcounts.setdefault(r["board_link_id"], {})[r["emoji"]] = r["n"]
        bmine = dict(BoardLinkReaction.objects.filter(board_link_id__in=bids, user=viewer).values_list("board_link_id", "emoji")) if authed else {}
    for d in rows:
        b = board_id(d)
        if b is not None:                                   # a link on a board reacts through its own address
            d["reactions"], d["my_reaction"], d["react_path"] = bcounts.get(b, {}), bmine.get(b, ""), f"/boards/links/{b}/react/"
            continue
        numeric = isinstance(d.get("id"), int)
        d["reactions"] = counts.get(d["id"], {}) if numeric else {}
        d["my_reaction"] = mine.get(d["id"], "") if numeric else ""
    return rows


class Guest:
    """Stands in for the viewer when nobody is logged in: sees only what is public, owns nothing."""
    id = 0
    pk = None
    is_authenticated = False
    nicknames = {}
    blocked_categories = []
    interests = []
    hide_adult = True       # logged out: 18+ content is never shown


GUEST = Guest()
