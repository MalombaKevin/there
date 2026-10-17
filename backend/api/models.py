from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q


class User(AbstractUser):
    email = models.EmailField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=60, blank=True)
    photo = models.TextField(blank=True, default="")          # URL or small data URL
    is_private = models.BooleanField(default=False)
    message_privacy = models.CharField(max_length=10, default="friends")   # who can message me: anyone | friends | none
    gender = models.CharField(max_length=10, blank=True, default="")      # "", female, male or other (optional, on the profile)
    country = models.CharField(max_length=2, blank=True, default="")      # ISO country code, optional
    show_gender = models.BooleanField(default=True)                       # whether the profile shows it
    show_country = models.BooleanField(default=True)
    blocked_countries = models.JSONField(default=list, blank=True)        # Discover: hide what people from these countries post (only those who show their country)
    blocked_keywords = models.JSONField(default=list, blank=True)         # Discover: hide links and boards whose words contain any of these
    invite_role = models.CharField(max_length=4, default="edit")      # board collaboration default: what people I invite may do (edit | view)
    invite_perms = models.JSONField(default=dict, blank=True)           # board collaboration default: extra things invited editors may do {delete, invite, remove, coown}
    invite_analytics = models.BooleanField(default=False)               # board collaboration default: invited collaborators may see the board's analytics
    qr_messages = models.BooleanField(default=True)                 # whether others may send me messages as a QR code
    status = models.JSONField(default=list, blank=True)              # my OPALS status, shaped like a card's: links and boards my OPALS see when they tap my picture (up to 10)
    status_days = models.PositiveSmallIntegerField(default=1)        # how long it stays: 1 to 30 days after it was last changed
    status_at = models.DateTimeField(null=True, blank=True)          # when it was last changed (the days count from here)
    qr_private = models.BooleanField(default=False)                 # QR privacy: my QR messages destroy themselves once the other person has viewed them
    auto_delete_days = models.PositiveSmallIntegerField(default=0)   # my messages delete themselves after this many days (0 = never); used for any kind not set below
    auto_delete = models.JSONField(default=dict, blank=True)         # per kind: {"link": days, "qr": days, "board": days}; days 0 = never
    interests = models.JSONField(default=list, blank=True)           # category ids; empty = everything
    interests_set = models.BooleanField(default=False)
    blocked_categories = models.JSONField(default=list, blank=True)
    hide_adult = models.BooleanField(default=False)
    nicknames = models.JSONField(default=dict, blank=True)           # {user_id: nickname}
    is_pro = models.BooleanField(default=False)                      # upgraded: more cards and tabs
    last_seen = models.DateTimeField(null=True, blank=True)          # heartbeat from the open app; drives the online dot

    def display(self):
        return self.name or self.username


class Link(models.Model):
    SOURCES = [("mine", "Mine"), ("saved", "Saved")]
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="links")
    url = models.URLField(max_length=1000)
    key = models.CharField(max_length=600)
    host = models.CharField(max_length=200)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    image = models.TextField(blank=True)
    logo = models.TextField(blank=True)
    custom_image = models.BooleanField(default=False)
    category = models.CharField(max_length=20, default="other", db_index=True)
    is_public = models.BooleanField(default=False)
    adult = models.BooleanField(default=False)
    source = models.CharField(max_length=10, choices=SOURCES, default="mine")
    saved_from = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    advertised = models.BooleanField(default=False, db_index=True)
    advertised_at = models.DateTimeField(null=True, blank=True)       # when it was advertised: for 6 hours after, it sits at the top of Discover
    pitch = models.CharField(max_length=200, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]
        unique_together = [("owner", "key")]
        indexes = [models.Index(fields=["is_public", "source"])]          # Discover


class Board(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="owned_boards")
    name = models.CharField(max_length=30)
    slug = models.CharField(max_length=40, blank=True, default="")      # the board's name as it appears in its address (unique per owner)
    is_public = models.BooleanField(default=False)
    color = models.CharField(max_length=7, blank=True, default="")     # #rrggbb accent, or none
    emoji = models.CharField(max_length=8, blank=True, default="")
    image = models.TextField(blank=True, default="")                   # owner-chosen cover picture (URL or small data URL)
    category = models.CharField(max_length=20, blank=True, default="")  # chosen or typed by the owner; empty = none
    members = models.ManyToManyField(User, through="BoardMember", related_name="boards")
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created"]


class BoardSave(models.Model):
    """Someone saved a public board. It follows the board live; when the owner makes it private,
    `snapshot` freezes what it looked like, and clears again if it goes public."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="saved_boards")
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="saves")
    snapshot = models.JSONField(null=True, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "board")]
        ordering = ["-created"]


class BoardMember(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=4, default="edit")   # edit | view (the owner is always edit)
    can_analytics = models.BooleanField(default=False)      # may see the board's analytics (the owner always can)
    can_delete = models.BooleanField(default=False)         # an editor who may also delete other people's links on the board
    can_invite = models.BooleanField(default=False)         # may invite other OPALS to the board
    can_remove = models.BooleanField(default=False)         # may remove collaborators from the board
    co_owner = models.BooleanField(default=False)           # may do everything the owner can, except delete the board or remove the owner
    joined = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "user")]


class BoardLink(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="links")
    added_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    from_user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    url = models.URLField(max_length=1000)
    key = models.CharField(max_length=600)
    host = models.CharField(max_length=200)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    image = models.TextField(blank=True)
    logo = models.TextField(blank=True)
    category = models.CharField(max_length=20, default="other")
    adult = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]
        unique_together = [("board", "key")]
        indexes = [models.Index(fields=["category"])]                     # Discover, category counts


class BoardInvite(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="invites")
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="board_invites")
    status = models.CharField(max_length=10, default="pending")   # pending | accepted | declined
    role = models.CharField(max_length=4, default="edit")          # what the invitee may do: edit | view
    can_analytics = models.BooleanField(default=False)             # whether they may also see the board's analytics
    can_delete = models.BooleanField(default=False)         # an editor who may also delete other people's links on the board
    can_invite = models.BooleanField(default=False)         # may invite other OPALS to the board
    can_remove = models.BooleanField(default=False)         # may remove collaborators from the board
    co_owner = models.BooleanField(default=False)           # may do everything the owner can, except delete the board or remove the owner
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "to_user")]


class Follow(models.Model):
    follower = models.ForeignKey(User, on_delete=models.CASCADE, related_name="following_set")
    target = models.ForeignKey(User, on_delete=models.CASCADE, related_name="follower_set")
    status = models.CharField(max_length=10, default="accepted")  # pending | accepted
    seen = models.BooleanField(default=False)                     # target has looked at this new follower
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("follower", "target")]
        indexes = [models.Index(fields=["target", "status", "seen"])]     # follower alerts + badge


class Friendship(models.Model):
    requester = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    addressee = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    status = models.CharField(max_length=10, default="pending")   # pending | accepted
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("requester", "addressee")]

    @staticmethod
    def between(a, b):
        return Friendship.objects.filter(Q(requester=a, addressee=b) | Q(requester=b, addressee=a)).first()


class Message(models.Model):
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sent")
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="received")
    kind = models.CharField(max_length=15, default="link")        # link | board_invite
    url = models.URLField(max_length=1000, blank=True)
    title = models.CharField(max_length=300, blank=True)
    image = models.TextField(blank=True)
    note = models.CharField(max_length=1500, blank=True)           # a link's note, or the text of a QR message (up to 100 words)
    reply_to = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")   # the message this one answers (long press or the 3 dots, Reply)
    destroy_on_view = models.BooleanField(default=False)          # a private QR message: gone for both people once the recipient has viewed it
    opened = models.BooleanField(default=False)                  # a QR message: the person it was sent to has opened it (it opens once)
    invite = models.ForeignKey(BoardInvite, null=True, blank=True, on_delete=models.CASCADE)
    read = models.BooleanField(default=False)                     # seen by the recipient
    sender_deleted = models.BooleanField(default=False)           # each side can delete a message from their own chat
    recipient_deleted = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created"]
        indexes = [models.Index(fields=["recipient", "read"]),            # unread badge (polled every few seconds)
                   models.Index(fields=["sender", "recipient"])]          # a chat's messages


class Block(models.Model):
    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocks")
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocked_by")
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("blocker", "blocked")]


class Lock(models.Model):
    KINDS = [("chat", "chat"), ("board", "board")]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="locks")
    kind = models.CharField(max_length=10, choices=KINDS)
    target = models.CharField(max_length=40)
    pin_hash = models.CharField(max_length=200)

    class Meta:
        unique_together = [("user", "kind", "target")]


class Activity(models.Model):
    """One view / save / share of someone's link or board, for their Analytics page."""
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")            # whose content it was
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    kind = models.CharField(max_length=5)                                                     # view | save | share | click
    link = models.ForeignKey(Link, null=True, blank=True, on_delete=models.CASCADE, related_name="activity")
    board = models.ForeignKey(Board, null=True, blank=True, on_delete=models.CASCADE, related_name="activity")
    card = models.ForeignKey("LinkPage", null=True, blank=True, on_delete=models.CASCADE, related_name="activity")   # an OCARD: view | click (on one of its links) | share
    item = models.CharField(max_length=20, blank=True, default="")                                                    # which link on the card was clicked
    created = models.DateTimeField(auto_now_add=True, db_index=True)


class Reaction(models.Model):
    """One emoji reaction per person per public link."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    link = models.ForeignKey(Link, on_delete=models.CASCADE, related_name="reactions")
    emoji = models.CharField(max_length=8)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "link")]


class BoardLinkReaction(models.Model):
    """One emoji reaction per person per link on a board."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    board_link = models.ForeignKey(BoardLink, on_delete=models.CASCADE, related_name="reactions")
    emoji = models.CharField(max_length=8)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "board_link")]


class LinkPage(models.Model):
    """One of a person's shareable cards (up to 3): banner, picture, short description and up to 16 links, split over a first tab that holds them all plus up to 3 tabs of their own."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="cards")      # up to 3 cards each
    name = models.CharField(max_length=40, blank=True, default="")    # the card's own name, shown on the card and in lists (the address is separate)
    handle = models.CharField(max_length=30, unique=True)            # the page address: /<handle>/ocard
    bio = models.CharField(max_length=300, blank=True, default="")    # at most 28 words
    banner = models.TextField(blank=True, default="")                 # wide LinkedIn-style banner picture
    background = models.TextField(blank=True, default="")             # picture behind the whole card page
    items = models.JSONField(default=list, blank=True)                # [{"id", "name", "url", "icon"}], at most 16
    main_name = models.CharField(max_length=20, default="My Card")  # the first tab, which holds every link
    main_hidden = models.BooleanField(default=False)
    main_desc = models.CharField(max_length=200, blank=True, default="")   # optional line above the first tab's links, up to 14 words
    main_desc_below = models.BooleanField(default=False)                    # the first tab's description sits below its links instead of above
    adult = models.BooleanField(default=False)                        # the owner says this card has 18+ content (any link marked 18+ also counts)
    main_pos = models.PositiveSmallIntegerField(default=0)           # where the first tab sits among the tabs (people can drag tabs around)
    on_profile = models.BooleanField(default=False)                   # the one card shown on the owner's profile ("View Card")
    status = models.JSONField(default=list, blank=True)               # like a story: links and boards shown when someone taps the card's picture, after the picture itself
    status_days = models.PositiveSmallIntegerField(default=1)         # how long the status stays: 1 to 30 days after it was last changed
    status_at = models.DateTimeField(null=True, blank=True)           # when the status was set (the days count from here)
    tabs = models.JSONField(default=list, blank=True)                 # up to 3 more: [{"name", "icon", "item_ids": [up to 6]}]
    link_view = models.CharField(max_length=5, default="small")       # how the links look by default: "small" rows or "large" preview cards (visitors can switch)
    socials = models.JSONField(default=list, blank=True)              # icon-only links under the description: [{"kind": "instagram", "url"}], up to 8


class ShortLink(models.Model):
    """A short address for a long link: /s/<code> sends people to `url`. `clicks` counts every use."""
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="shortlinks")
    code = models.CharField(max_length=32, unique=True)
    url = models.URLField(max_length=2000)
    clicks = models.PositiveIntegerField(default=0)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]
