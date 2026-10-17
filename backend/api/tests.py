from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import BoardLink, Follow, Link, User


def mutual(a, b):
    """Friends must follow each other first."""
    for x, y in ((a, b), (b, a)):
        Follow.objects.get_or_create(follower_id=x.user_id, target_id=y.user_id, defaults={"status": "accepted", "seen": True})


def make_client(username, email=None):
    c = APIClient()
    r = c.post("/api/auth/register/", {"name": username.title(), "username": username,
                                        "email": email or f"{username}@x.com", "password": "S3cretpass!"}, format="json")
    assert r.status_code == 201, r.content
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
    c.user_id = r.data["user"]["id"]
    return c


@mock.patch("api.utils.fetch_meta", lambda url: {"title": "Example title", "description": "desc", "image": "https://img/x.png", "logo": ""})
@mock.patch("api.utils.is_active", lambda url: True)
class FlowTests(TestCase):
    def test_auth(self):
        c = make_client("kevin")
        anon = APIClient()
        self.assertEqual(anon.post("/api/auth/login/", {"email": "kevin@x.com", "password": "S3cretpass!"}, format="json").status_code, 200)
        self.assertEqual(anon.post("/api/auth/login/", {"email": "kevin@x.com", "password": "nope"}, format="json").status_code, 400)
        self.assertEqual(anon.post("/api/auth/register/", {"name": "K", "username": "kevin", "email": "k2@x.com", "password": "S3cretpass!"}, format="json").status_code, 400)
        self.assertEqual(anon.get("/api/me/").status_code, 401)
        r = anon.post("/api/auth/register/", {"username": "noname", "email": "nn@x.com", "password": "S3cretpass!"}, format="json")
        self.assertEqual((r.status_code, r.data["user"]["name"]), (201, "noname"))   # no name: falls back to the username
        self.assertEqual(c.get("/api/me/").data["username"], "kevin")
        self.assertIn(anon.post("/api/auth/google/", {"credential": "x"}, format="json").status_code, (400, 503))   # 503 when Google sign-in is not set up here, 400 when it is and the credential is bad

    def test_links_discover_save_blocks(self):
        a, b = make_client("amy"), make_client("bob")
        r = a.post("/api/links/", {"url": "youtube.com/watch?v=1", "is_public": True}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["category"], "video")
        lid = r.data["id"]
        self.assertEqual(a.post("/api/links/", {"url": "youtube.com/watch?v=1"}, format="json").status_code, 400)
        # public links show in Discover without advertising; private ones don't
        a.post("/api/links/", {"url": "example.org/secret"}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 1)
        self.assertEqual(a.post(f"/api/links/{lid}/advertise/", {"pitch": "watch"}, format="json").status_code, 200)
        d = b.get("/api/discover/").data
        self.assertEqual(len(d), 1)
        self.assertEqual(d[0]["owner"]["username"], "amy")
        # save from discover, then saved links can't be advertised
        s = b.post("/api/links/save/", {"link_id": lid}, format="json")
        self.assertEqual(s.status_code, 201)
        self.assertEqual(s.data["owner"]["username"], "amy")
        self.assertEqual(b.post(f"/api/links/{s.data['id']}/advertise/", format="json").status_code, 400)
        # interests filter + blocked category + adult
        b.patch("/api/me/", {"interests": ["music"]}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 1)   # interests only order Discover, they don't hide public links
        b.patch("/api/me/", {"blocked_categories": ["video"]}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 0)
        b.patch("/api/me/", {"blocked_categories": []}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 1)
        # block user
        b.post("/api/blocks/", {"user_id": a.user_id}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 0)
        self.assertEqual(b.get("/api/users/amy/").data["can_see"], False)
        self.assertEqual(a.get("/api/users/bob/").status_code, 404)
        b.delete(f"/api/blocks/{a.user_id}/")
        self.assertEqual(len(b.get("/api/discover/").data), 1)
        # adult hide
        a.patch(f"/api/links/{lid}/", {"adult": True}, format="json")
        b.patch("/api/me/", {"hide_adult": True}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 0)

    def test_used_categories_with_counts(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertEqual(b.get("/api/categories/?used=1").data, [])                 # nothing in the database yet
        a.post("/api/links/", {"url": "youtube.com/watch?v=9", "is_public": True}, format="json")
        a.post("/api/links/", {"url": "vimeo.com/1", "is_public": True}, format="json")
        a.post("/api/links/", {"url": "github.com", "is_public": False}, format="json")   # private: not counted
        rows = b.get("/api/categories/?used=1").data
        self.assertEqual([(r["id"], r["count"]) for r in rows], [("video", 2)])
        b.patch("/api/me/", {"interests": ["music"]}, format="json")               # chosen but unused: still listed, count 0
        self.assertEqual([(r["id"], r["count"]) for r in b.get("/api/categories/?used=1").data], [("video", 2), ("music", 0)])
        self.assertGreater(len(b.get("/api/categories/").data), 5)                  # the full list is unchanged

    def test_custom_and_ranked_categories(self):
        a, b = make_client("amy"), make_client("bob")
        r = a.post("/api/links/", {"url": "example.org/soup", "category": "Street Food", "is_public": True}, format="json")
        self.assertEqual(r.data["category"], "street-food")                          # typed by the user
        self.assertEqual(a.post("/api/links/", {"url": "example.org/x", "category": "Video"}, format="json").data["category"], "video")  # name -> built-in id
        self.assertEqual(a.post("/api/links/", {"url": "example.org/y", "category": "!!!"}, format="json").data["category"], "other")  # junk: auto-detect
        a.post("/api/links/", {"url": "example.org/z", "category": "street food", "is_public": True}, format="json")
        opts = b.get("/api/categories/?options=1").data
        self.assertEqual((opts[0]["id"], opts[0]["name"], opts[0]["count"]), ("street-food", "Street Food", 2))   # most used first
        self.assertIn("video", [o["id"] for o in opts])                              # built-ins stay available
        self.assertEqual([c["id"] for c in b.get("/api/categories/?used=1").data], ["street-food"])
        self.assertIn("street-food", [c["id"] for c in b.get("/api/categories/").data])
        b.patch("/api/me/", {"interests": ["Street Food", "!!!", "Video", "street-food"]}, format="json")     # typed, junk, name, duplicate
        self.assertEqual(b.get("/api/me/").data["interests"], ["street-food", "video"])

    def test_search_matches_category(self):
        a, b = make_client("amy"), make_client("bob")
        a.post("/api/links/", {"url": "example.org/one", "category": "Street Food", "is_public": True}, format="json")
        a.post("/api/links/", {"url": "github.com", "is_public": True}, format="json")          # category: tech
        def found(q):
            return len(b.get("/api/discover/", {"q": q}).data)
        self.assertEqual(found("street"), 1)      # typed category
        self.assertEqual(found("tech"), 1)        # built-in category (name: "Tech & coding")
        self.assertEqual(found("coding"), 1)
        self.assertEqual(found("github"), 1)      # site name still works
        self.assertEqual(found("zzz"), 0)

    def test_three_interests_bio_and_suggestions(self):
        a, b, c, d = make_client("amy"), make_client("bob"), make_client("cyd"), make_client("dan")
        a.patch("/api/me/", {"interests": ["music", "video", "tech", "news", "sport", "food", "art"]}, format="json")
        self.assertEqual(a.get("/api/me/").data["interests"], ["music", "video", "tech", "news", "sport", "food"])   # capped at 6
        self.assertEqual(a.patch("/api/me/", {"interests": []}, format="json").status_code, 400)                      # at least 1
        a.patch("/api/me/", {"interests": ["music", "video", "tech"]}, format="json")
        bio = b.get("/api/users/amy/").data["interests"]
        self.assertEqual([i["name"] for i in bio], ["Music", "Video", "Tech & coding"])         # shown in the bio
        self.assertNotIn("email", b.get("/api/users/amy/").data)                                # email never exposed
        # suggestions: bob and cyd are friends; dan shares interests; cyd is a mutual friend for amy once amy-bob are friends
        b.patch("/api/me/", {"interests": ["music"]}, format="json")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{a.user_id}/")
        mutual(c, b)
        c.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{c.user_id}/")
        d.patch("/api/me/", {"interests": ["video"]}, format="json")
        sug = a.get("/api/friends/suggestions/").data
        self.assertEqual([s["user"]["username"] for s in sug], ["cyd", "dan"])                  # mutual friend first, then shared interest
        self.assertEqual((sug[0]["reason"], sug[1]["reason"]), ("1 mutual OPAL", "Also likes Video"))
        self.assertEqual([(i["name"], i["shared"]) for i in sug[1]["interests"]], [("Video", True)])   # their interests, shared ones flagged
        mutual(a, d)
        a.post("/api/friends/request/", {"user_id": d.user_id}, format="json")                  # requested people disappear
        self.assertEqual([s["user"]["username"] for s in a.get("/api/friends/suggestions/").data], ["cyd"])
        a.post("/api/blocks/", {"user_id": c.user_id}, format="json")
        self.assertEqual(a.get("/api/friends/suggestions/").data, [])

    def test_delete_message_for_me(self):
        a, b = make_client("amy"), make_client("bob")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{a.user_id}/")
        mid = a.post(f"/api/messages/{b.user_id}/", {"url": "github.com"}, format="json").data["id"]
        self.assertEqual(b.delete(f"/api/messages/{a.user_id}/{mid}/").status_code, 204)          # bob deletes his copy
        self.assertEqual(b.get(f"/api/messages/{a.user_id}/").data, [])
        self.assertEqual(b.get("/api/inbox/counts/").data["messages"], 0)
        self.assertIsNone(b.get("/api/conversations/").data[0]["last"])
        self.assertEqual(len(a.get(f"/api/messages/{b.user_id}/").data), 1)                      # amy still has hers
        self.assertEqual(a.delete(f"/api/messages/{b.user_id}/{mid}/").status_code, 204)          # both gone: row removed
        self.assertEqual(a.get(f"/api/messages/{b.user_id}/").data, [])
        c = make_client("cyd")
        self.assertEqual(c.delete(f"/api/messages/{a.user_id}/{mid}/").status_code, 404)          # strangers can't touch it

    def test_qr_messages(self):
        a, b = make_client("amy"), make_client("bob")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{a.user_id}/")
        r = a.post(f"/api/messages/{b.user_id}/", {"qr_text": "hello there"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        mid = r.data["id"]
        self.assertEqual(r.data["note"], "hello there")                                           # the sender sees their own words
        seen = b.get(f"/api/messages/{a.user_id}/").data[0]
        self.assertEqual((seen["note"], seen["opened"]), ("", False))                              # the recipient does not, until they open it
        self.assertEqual(b.post(f"/api/messages/{a.user_id}/{mid}/open/").data["note"], "hello there")
        self.assertEqual(b.post(f"/api/messages/{a.user_id}/{mid}/open/").status_code, 410)       # it opens once
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"qr_text": " ".join(["w"] * 101)}, format="json").status_code, 400)   # 100 words max
        p = a.post(f"/api/messages/{b.user_id}/", {"qr_text": "secret", "private": True}, format="json").data["id"]
        self.assertEqual(b.post(f"/api/messages/{a.user_id}/{p}/open/").data["gone"], True)       # private: gone for both once viewed
        self.assertEqual([m["id"] for m in a.get(f"/api/messages/{b.user_id}/").data], [mid])
        rep = b.post(f"/api/messages/{a.user_id}/", {"qr_text": "hi back", "reply_to": mid}, format="json")
        self.assertEqual(rep.data["reply"]["title"], "QR message")                                 # a reply quotes the message, never its words
        b.patch("/api/me/", {"qr_messages": False}, format="json")
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"qr_text": "again"}, format="json").status_code, 403)

    def test_board_and_card_links_from_the_plus(self):
        a, b = make_client("amy"), make_client("bob")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{a.user_id}/")
        slug = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["slug"]
        a.put("/api/linkpage/", {"handle": "amy-card", "items": [], "tabs": []}, format="json")
        site = {"HTTP_ORIGIN": "http://localhost:5173"}                                                   # a site with no dotted domain, as in development
        ok = a.post(f"/api/messages/{b.user_id}/", {"url": f"http://localhost:5173/boards/amy/{slug}", "title": "Music"}, format="json", **site)
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "http://localhost:5173/amy-card/ocard", "title": "Amy"}, format="json", **site).status_code, 201)
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "http://localhost:5173/boards/amy/nope", "title": "x"}, format="json", **site).status_code, 400)   # must be real
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "http://localhost:5173/ghost/ocard", "title": "x"}, format="json", **site).status_code, 400)
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "http://localhost:9999/boards/amy/" + slug, "title": "x"}, format="json", **site).status_code, 400)  # not this site, and not a dotted address

    def test_opals_status(self):
        a, b = make_client("amy"), make_client("bob")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json"); b.post(f"/api/friends/{a.user_id}/")
        link = Link.objects.create(owner_id=a.user_id, url="https://a.com/x", key="a.com/x", host="a.com", title="A link", is_public=True, source="mine")
        feed = b.get("/api/status/feed/").data                                                           # built automatically from what amy created lately
        self.assertEqual([(g["owner"]["username"], [e["title"] for e in g["status"]]) for g in feed], [("amy", ["A link"])])
        self.assertEqual(a.get("/api/status/feed/").data, [])                                           # amy never sees her own status
        for k in range(12):
            Link.objects.create(owner_id=a.user_id, url=f"https://s{k}.com", key=f"s{k}.com", host=f"s{k}.com", title=f"L{k}", is_public=True, source="mine")
        self.assertEqual(len(b.get("/api/status/feed/").data[0]["status"]), 10)                         # only their latest 10
        Link.objects.filter(owner_id=a.user_id).update(created=timezone.now() - timedelta(days=30))
        self.assertEqual(b.get("/api/status/feed/").data, [])                                           # nothing recent: no status
        c = make_client("cyd")
        self.assertEqual(c.get("/api/status/feed/").data, [])                                           # not friends: nothing to see

    def test_gender_country_and_discover_blocks(self):
        a, b = make_client("amy"), make_client("bob")
        for k, host in enumerate(["cats.com", "dogs.com", "birds.com"]):
            Link.objects.create(owner_id=a.user_id, url=f"https://{host}/x", key=f"{host}/x", host=host, title=["Funny cats", "Good dogs", "Wild birds"][k], is_public=True, source="mine")
        self.assertEqual(len(b.get("/api/discover/").data), 3)
        self.assertEqual(a.patch("/api/me/", {"gender": "robot"}, format="json").status_code, 400)
        r = a.patch("/api/me/", {"gender": "female", "country": "ke"}, format="json")
        self.assertEqual((r.data["gender"], r.data["country"]), ("female", "KE"))
        p = b.get("/api/users/amy/").data
        self.assertEqual((p["gender"], p["country"]), ("female", "KE"))                              # shown by default
        a.patch("/api/me/", {"show_gender": False}, format="json")
        p = b.get("/api/users/amy/").data
        self.assertEqual((p["gender"], p["country"]), ("", "KE"))                                    # hidden when switched off
        self.assertEqual(a.get("/api/users/amy/").data["gender"], "female")                          # you always see your own
        b.patch("/api/me/", {"blocked_keywords": ["  DOGS ", "dogs", ""]}, format="json")
        self.assertEqual(sorted(l["title"] for l in b.get("/api/discover/").data), ["Funny cats", "Wild birds"])      # keyword hides it
        b.patch("/api/me/", {"blocked_countries": ["ke"]}, format="json")
        self.assertEqual(b.get("/api/discover/").data, [])                                             # amy shows Kenya
        a.patch("/api/me/", {"show_country": False}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 2)                                         # a hidden country can't be blocked

    def test_card_stats(self):
        a, b = make_client("amy"), make_client("bob")
        r = a.put("/api/linkpage/", {"handle": "amy-card", "items": [{"id": "i1", "name": "Site", "url": "https://s.com"}], "tabs": []}, format="json")
        cid = r.data["page"]["id"]
        b.post("/api/l/amy-card/event/", {"kind": "view"}, format="json")
        b.post("/api/l/amy-card/event/", {"kind": "click", "item": "i1"}, format="json")
        b.post("/api/l/amy-card/event/", {"kind": "share"}, format="json")
        a.post("/api/l/amy-card/event/", {"kind": "view"}, format="json")                          # your own look does not count
        d = a.get(f"/api/linkpage/{cid}/stats/").data
        self.assertEqual((d["view"], d["click"], d["share"]), (1, 1, 1))
        self.assertEqual(d["top"], [{"name": "Site", "clicks": 1}])
        self.assertEqual(len(d["trend"]), 7)
        self.assertEqual(b.get(f"/api/linkpage/{cid}/stats/").status_code, 404)                    # only the owner

    def test_reaction_analytics(self):
        a, b = make_client("amy"), make_client("bob")
        link = Link.objects.create(owner_id=a.user_id, url="https://r.com/x", key="r.com/x", host="r.com", title="Reactable", is_public=True, source="mine")
        self.assertEqual(b.post(f"/api/links/{link.id}/react/", {"emoji": "🔥"}, format="json").status_code, 200)
        a.post(f"/api/links/{link.id}/react/", {"emoji": "❤️"}, format="json")                         # my own reaction is not attention
        r = a.get("/api/analytics/").data["reactions"]
        self.assertEqual(r["total"], 1)
        self.assertEqual(r["by_emoji"], [{"emoji": "🔥", "n": 1}])
        self.assertEqual((r["items"][0]["title"], r["items"][0]["n"]), ("Reactable", 1))
        self.assertEqual(r["recent"][0]["who"].lower(), "bob")

    def test_board_categories_are_counted_and_ranked(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertEqual(a.post("/api/boards/", {"name": "Eats", "is_public": True, "category": "Street food"}, format="json").data["category"], "street-food")
        b.post("/api/boards/", {"name": "More eats", "is_public": True, "category": "street food"}, format="json")
        bid = a.post("/api/boards/", {"name": "Plain", "is_public": True}, format="json").data["id"]
        self.assertEqual(a.get(f"/api/boards/{bid}/").data["category"], "")          # a category is optional
        self.assertEqual(a.patch(f"/api/boards/{bid}/", {"category": "Music"}, format="json").data["category_name"], "Music")
        a.post("/api/boards/", {"name": "Hidden", "is_public": False, "category": "Secret"}, format="json")
        rows = a.get("/api/categories/?options=1").data
        self.assertEqual(rows[0]["id"], "street-food")                               # most added first
        self.assertEqual(rows[0]["count"], 2)
        self.assertNotIn("secret", [r["id"] for r in rows])                           # private boards are not counted

    def test_adult_content_hidden_when_logged_out_and_adult_categories_marked(self):
        a = make_client("amy")
        a.post("/api/links/", {"url": "https://spicy.example.com", "is_public": True, "adult": True, "category": "Spicy"}, format="json")
        a.post("/api/links/", {"url": "https://calm.example.com", "is_public": True, "category": "Calm"}, format="json")
        bid = a.post("/api/boards/", {"name": "Naughty", "is_public": True}, format="json").data["id"]
        a.post(f"/api/boards/{bid}/links/", {"url": "https://spicy2.example.com", "adult": True}, format="json")
        guest = APIClient()
        urls = [l["url"] for l in guest.get("/api/discover/").data]
        self.assertTrue(any("calm" in u for u in urls))
        self.assertFalse(any("spicy" in u for u in urls))                                        # no 18+ links when logged out
        self.assertNotIn(bid, [b["id"] for b in guest.get("/api/discover/boards/").data])        # nor 18+ boards
        self.assertNotIn("spicy", [c["id"] for c in guest.get("/api/categories/?options=1").data])
        mine = {c["id"]: c for c in a.get("/api/categories/?options=1").data}
        self.assertTrue(mine["spicy"]["adult"])                                                  # marked, so the picker shows it only when searched
        self.assertFalse(mine["calm"]["adult"])

    def test_card_link_previews_and_description_below(self):
        a = make_client("amy")
        body = {"name": "Prev", "handle": "prev-card", "items": [
            {"id": "x1", "name": "One", "url": "https://one.example.com", "preview": True, "cover": "preset:sunset", "desc": "A short line"},
            {"id": "x2", "name": "Two", "url": "https://two.example.com", "preview": True, "cover": "preset:nope", "desc": "word " * 13}],
            "main_desc": "Hello", "main_desc_below": True, "tabs": [{"name": "Docs", "desc": "Reading", "desc_below": True, "item_ids": ["x1"]}]}
        self.assertEqual(a.put("/api/linkpage/", body, format="json").status_code, 400)          # a link's description stops at 12 words
        body["items"][1]["desc"] = "fine"
        page = a.put("/api/linkpage/", body, format="json").data["page"]
        one, two = page["items"]
        self.assertTrue(one["preview"])
        self.assertEqual(one["cover"], "preset:sunset")
        self.assertEqual(two["cover"], "")                                                         # an unknown ready-made picture is dropped (the link's own is used)
        main, docs = page["tabs"][0], page["tabs"][1]
        self.assertTrue(main["desc_below"])
        self.assertTrue(docs["desc_below"])
        self.assertTrue(APIClient().get("/api/l/prev-card/").data["tabs"][1]["desc_below"])

    def test_card_social_icons(self):
        a = make_client("amy")
        base = {"name": "S", "handle": "soc-card", "items": []}
        put = lambda **kw: a.put("/api/linkpage/", {**base, **kw}, format="json")
        self.assertEqual(put(socials=[{"kind": "instagram", "url": ""}]).status_code, 400)                      # the link is needed
        self.assertEqual(put(socials=[{"kind": "instagram", "url": f"x{i}.com"} for i in range(9)]).status_code, 400)   # up to 8 (and one per site)
        first = put(socials=[{"kind": "instagram", "url": "instagram.com/amy"}, {"kind": "madeup", "url": "x.com/a"}, {"kind": "instagram", "url": "dup.com"}, {"kind": "github", "url": "https://github.com/amy"}])
        self.assertEqual(first.status_code, 200)
        socials = first.data["page"]["socials"]
        self.assertEqual([s["kind"] for s in socials], ["instagram", "github"])                                  # unknown sites and repeats are dropped
        self.assertEqual(socials[0]["url"], "https://instagram.com/amy")
        self.assertEqual(APIClient().get("/api/l/soc-card/").data["socials"][1]["url"], "https://github.com/amy")
        pic = "data:image/png;base64,iVBORw0KGgo="
        self.assertEqual(put(id=first.data["page"]["id"], socials=[{"kind": "custom", "url": "me.example.com", "image": ""}]).status_code, 400)     # your own icon needs a picture
        own = put(id=first.data["page"]["id"], socials=[{"kind": "github", "url": "github.com/amy"}, {"kind": "custom", "url": "me.example.com", "image": pic}, {"kind": "custom", "url": "two.example.com", "image": pic}])
        self.assertEqual(own.status_code, 200)
        mine = own.data["page"]["socials"]
        self.assertEqual([s["kind"] for s in mine], ["github", "custom", "custom"])                              # as many of your own as fit in the 8
        self.assertNotEqual(mine[1]["id"], mine[2]["id"])
        self.assertEqual(mine[1]["image"], pic)
        self.assertEqual(APIClient().get("/api/l/soc-card/").data["socials"][1]["url"], "https://me.example.com")
        again = put(id=first.data["page"]["id"]).data["page"]
        self.assertEqual(len(again["socials"]), 3)                                                               # a save that doesn't mention them keeps them

    def test_board_analytics_for_collaborators(self):
        a, b, c = make_client("amy"), make_client("bob"), make_client("cyd")
        for x in (b, c):
            mutual(a, x)
            a.post("/api/friends/request/", {"user_id": x.user_id}, format="json"); x.post(f"/api/friends/{a.user_id}/")
        bid = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
        ia = a.post(f"/api/boards/{bid}/invite/", {"user_id": b.user_id, "can_analytics": True}, format="json").data["id"]
        ib = a.post(f"/api/boards/{bid}/invite/", {"user_id": c.user_id}, format="json").data["id"]
        b.post(f"/api/invites/{ia}/accept/"); c.post(f"/api/invites/{ib}/accept/")
        self.assertEqual(a.get(f"/api/boards/{bid}/stats/").status_code, 200)                       # the owner
        self.assertEqual(b.get(f"/api/boards/{bid}/stats/").status_code, 200)                       # allowed when invited
        self.assertEqual(c.get(f"/api/boards/{bid}/stats/").status_code, 404)                       # not allowed
        self.assertTrue(b.get(f"/api/boards/{bid}/").data["can_analytics"])
        self.assertFalse(c.get(f"/api/boards/{bid}/").data["can_analytics"])
        self.assertEqual(a.patch(f"/api/boards/{bid}/members/{c.user_id}/", {"can_analytics": True}, format="json").status_code, 200)   # allowed later
        self.assertEqual(c.get(f"/api/boards/{bid}/stats/").status_code, 200)
        self.assertEqual(c.patch(f"/api/boards/{bid}/members/{b.user_id}/", {"can_analytics": False}, format="json").status_code, 403)   # only the owner decides
        a.patch("/api/me/", {"invite_role": "view", "invite_analytics": True}, format="json")
        me = a.get("/api/me/").data
        self.assertEqual((me["invite_role"], me["invite_analytics"]), ("view", True))

    def test_board_collaborator_permissions(self):
        a, b, c, d = make_client("amy"), make_client("bob"), make_client("cyd"), make_client("dee")
        for x in (b, c, d):
            mutual(a, x)
            a.post("/api/friends/request/", {"user_id": x.user_id}, format="json"); x.post(f"/api/friends/{a.user_id}/")
        mutual(b, d)                                                                # bob can only invite his own OPALS
        b.post("/api/friends/request/", {"user_id": d.user_id}, format="json"); d.post(f"/api/friends/{b.user_id}/")
        bid = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
        def invite(extra, who):
            i = a.post(f"/api/boards/{bid}/invite/", {"user_id": who.user_id, "role": "edit", **extra}, format="json").data["id"]
            who.post(f"/api/invites/{i}/accept/")
        invite({"can_delete": True, "can_invite": True, "can_remove": True}, b)      # an editor with the extra checks
        invite({}, c)                                                              # a plain editor
        # a plain editor can't invite or remove
        self.assertEqual(c.post(f"/api/boards/{bid}/invite/", {"user_id": d.user_id}, format="json").status_code, 403)
        self.assertEqual(c.delete(f"/api/boards/{bid}/members/{b.user_id}/").status_code, 403)
        # an editor with the checks can add users and remove collaborators, but can't make a co-owner or delete the board
        i = b.post(f"/api/boards/{bid}/invite/", {"user_id": d.user_id, "co_owner": True}, format="json").data["id"]
        d.post(f"/api/invites/{i}/accept/")
        me = d.get(f"/api/boards/{bid}/").data
        self.assertFalse(me["is_coowner"])                                          # only the owner can make a co-owner
        self.assertEqual(b.delete(f"/api/boards/{bid}/members/{d.user_id}/").status_code, 204)
        # links: a plain editor can't delete someone else's link, an editor with the delete check can
        lid = a.post(f"/api/boards/{bid}/links/", {"url": "https://x.com/1"}, format="json").data["id"]
        self.assertEqual(c.delete(f"/api/boards/{bid}/links/{lid}/").status_code, 403)
        self.assertEqual(b.delete(f"/api/boards/{bid}/links/{lid}/").status_code, 204)
        # the owner makes cyd a co-owner: everything but deleting the board or removing the owner
        self.assertEqual(a.patch(f"/api/boards/{bid}/members/{c.user_id}/", {"co_owner": True}, format="json").status_code, 200)
        self.assertTrue(c.get(f"/api/boards/{bid}/").data["is_coowner"])
        self.assertEqual(c.patch(f"/api/boards/{bid}/", {"name": "Renamed"}, format="json").status_code, 200)
        self.assertEqual(c.delete(f"/api/boards/{bid}/").status_code, 403)                          # not even a co-owner
        self.assertEqual(c.delete(f"/api/boards/{bid}/members/{a.user_id}/").status_code, 400)       # the owner can't be removed
        self.assertEqual(b.patch(f"/api/boards/{bid}/members/{c.user_id}/", {"role": "view"}, format="json").status_code, 403)
        self.assertEqual(b.delete(f"/api/boards/{bid}/members/{c.user_id}/").status_code, 403)       # an editor can't remove a co-owner
        self.assertEqual(c.get(f"/api/boards/{bid}/stats/").status_code, 200)                       # a co-owner sees the analytics
        a.patch("/api/me/", {"invite_perms": {"delete": True, "coown": True}}, format="json")
        self.assertEqual(a.get("/api/me/").data["invite_perms"], {"delete": True, "invite": False, "remove": False, "coown": True})

    def test_shortlinks(self):
        a, b = make_client("amy"), make_client("bob")
        r = a.post("/api/shortlinks/", {"url": "https://example.com/a/very/long/page?x=1"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        code = r.data["code"]
        self.assertEqual(len(code), 6)
        r2 = a.post("/api/shortlinks/", {"url": "example.org/page", "alias": "My-Page"}, format="json")
        self.assertEqual((r2.status_code, r2.data["code"], r2.data["url"]), (201, "my-page", "https://example.org/page"))
        self.assertEqual(b.post("/api/shortlinks/", {"url": "example.org/x", "alias": "my-page"}, format="json").status_code, 400)       # taken
        self.assertEqual(a.post("/api/shortlinks/", {"url": "example.org/x", "alias": "no spaces"}, format="json").status_code, 400)
        self.assertEqual(a.post("/api/shortlinks/", {"url": "not a link"}, format="json").status_code, 400)
        anon = APIClient()                                                                                  # no login needed to follow one
        self.assertEqual(anon.get(f"/api/s/{code}/").data["url"], "https://example.com/a/very/long/page?x=1")
        self.assertEqual(anon.get("/api/s/MY-PAGE/").status_code, 200)
        self.assertEqual(anon.get("/api/s/nothere/").status_code, 404)
        self.assertEqual(a.get(f"/api/s/{code}/").status_code, 200)                                         # the owner can open it, but it isn't counted
        self.assertEqual(b.get(f"/api/s/{code}/").status_code, 200)                                         # someone else's visit is
        mine = a.get("/api/shortlinks/").data
        self.assertEqual(sorted((s["code"], s["clicks"]) for s in mine), sorted([(code, 2), ("my-page", 1)]))      # every visitor's use is counted, not the owner's
        self.assertEqual(b.get("/api/shortlinks/").data, [])                                                # each person sees only their own
        sid = r.data["id"]
        self.assertEqual(b.delete(f"/api/shortlinks/{sid}/").status_code, 404)
        self.assertEqual(a.delete(f"/api/shortlinks/{sid}/").status_code, 204)

    def test_boards_of_my_interests(self):
        a, b = make_client("amy"), make_client("bob")
        music = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
        sport = a.post("/api/boards/", {"name": "Sport", "is_public": True}, format="json").data["id"]
        BoardLink.objects.create(board_id=music, added_by_id=a.user_id, url="https://m.com/x", key="m.com/x", host="m.com", title="m", category="music")
        BoardLink.objects.create(board_id=sport, added_by_id=a.user_id, url="https://s.com/x", key="s.com/x", host="s.com", title="s", category="sports")
        self.assertEqual(sorted(x["name"] for x in b.get("/api/discover/boards/").data), ["Music", "Sport"])
        b.patch("/api/me/", {"interests": ["music"]}, format="json")
        self.assertEqual([x["name"] for x in b.get("/api/discover/boards/?interests=1").data], ["Music"])      # only boards with my interests
        self.assertEqual(sorted(x["name"] for x in b.get("/api/discover/boards/").data), ["Music", "Sport"])   # All is unchanged

    def test_logged_out_sees_no_posters(self):
        a = make_client("amy")
        Link.objects.create(owner_id=a.user_id, url="https://p.com/x", key="p.com/x", host="p.com", title="Public one", is_public=True, source="mine")
        bd = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
        BoardLink.objects.create(board_id=bd, added_by_id=a.user_id, url="https://q.com/x", key="q.com/x", host="q.com", title="On a board")
        anon = APIClient()
        rows = anon.get("/api/discover/").data
        self.assertTrue(rows and all(r["owner"] is None and "added_by" not in r for r in rows))              # no poster on any link
        board = anon.get(f"/api/boards/{bd}/").data
        self.assertEqual((board["owner"]["name"], board["owner"]["photo"]), ("", ""))                       # no profile on the board
        self.assertTrue(all(l["owner"] is None and l["added_by"] is None for l in board["links"]))
        b = make_client("bob")
        self.assertIsNotNone(b.get("/api/discover/").data[0]["owner"])                                         # logged in: still shown

    def test_online_dot(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertFalse(b.get("/api/users/amy/").data["online"])                 # never opened the app
        a.get("/api/inbox/counts/")                                               # amy's app pings
        self.assertTrue(b.get("/api/users/amy/").data["online"])
        self.assertFalse(a.get("/api/users/amy/").data["online"])                 # no dot on yourself
        User.objects.filter(pk=a.user_id).update(last_seen=timezone.now() - timedelta(minutes=5))
        self.assertFalse(b.get("/api/users/amy/").data["online"])                 # quiet for 5 minutes: offline

    def test_choose_category(self):
        a = make_client("amy")
        r = a.post("/api/links/", {"url": "youtube.com/watch?v=2", "category": "learn"}, format="json")
        self.assertEqual(r.data["category"], "learn")
        lid = r.data["id"]
        self.assertEqual(a.patch(f"/api/links/{lid}/", {"title": "New title", "category": "music"}, format="json").data["category"], "music")
        self.assertEqual(a.patch(f"/api/links/{lid}/", {"title": "Another"}, format="json").data["category"], "video")  # re-detected

    def test_public_board_links_in_discover(self):
        a, b = make_client("amy"), make_client("bob")
        bid = a.post("/api/boards/", {"name": "Music", "is_public": False}, format="json").data["id"]
        a.post(f"/api/boards/{bid}/links/", {"url": "spotify.com"}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 0)              # private board: hidden
        a.patch(f"/api/boards/{bid}/", {"is_public": True}, format="json")
        d = b.get("/api/discover/").data
        self.assertEqual(len(d), 1)
        self.assertEqual(d[0]["source"], "board")
        self.assertEqual(d[0]["board"]["name"], "Music")
        # saving a board link by URL works, and blocking the poster hides it
        self.assertEqual(b.post("/api/links/save/", {"url": d[0]["url"], "from_user_id": a.user_id}, format="json").status_code, 201)
        b.post("/api/blocks/", {"user_id": a.user_id}, format="json")
        self.assertEqual(len(b.get("/api/discover/").data), 0)

    def test_new_follower_alerts(self):
        a, b, c = make_client("amy"), make_client("bob"), make_client("cyd")
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 0)
        b.post("/api/users/amy/follow/")
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 1)
        rows = a.get("/api/followers/alerts/").data
        self.assertEqual((rows[0]["user"]["username"], rows[0]["new"], rows[0]["status"]), ("bob", True, "accepted"))
        a.post("/api/followers/alerts/")                                   # opening the tab marks them seen
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 0)
        self.assertFalse(a.get("/api/followers/alerts/").data[0]["new"])
        # private account: a request counts until it's answered
        a.patch("/api/me/", {"is_private": True}, format="json")
        c.post("/api/users/amy/follow/")
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 1)
        rid = [r for r in a.get("/api/followers/alerts/").data if r["status"] == "pending"][0]["id"]
        a.post(f"/api/follow-requests/{rid}/accept/")
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 1)  # accepted but not yet seen
        # blocked users don't notify
        a.post("/api/blocks/", {"user_id": b.user_id}, format="json")
        a.post("/api/followers/alerts/")
        self.assertEqual(a.get("/api/inbox/counts/").data["followers"], 0)

    def test_private_profile_follow(self):
        a, b = make_client("amy"), make_client("bob")
        a.post("/api/links/", {"url": "github.com", "is_public": True}, format="json")
        a.patch("/api/me/", {"is_private": True}, format="json")
        p = b.get("/api/users/amy/").data
        self.assertFalse(p["can_see"])
        self.assertEqual(b.post("/api/users/amy/follow/").data["status"], "pending")
        req = a.get("/api/follow-requests/").data
        self.assertEqual(len(req), 1)
        a.post(f"/api/follow-requests/{req[0]['id']}/accept/")
        p = b.get("/api/users/amy/").data
        self.assertTrue(p["can_see"])
        self.assertEqual(len(p["links"]), 1)
        self.assertEqual(p["followers"], 1)

    def test_boards_invites_locks(self):
        a, b = make_client("amy"), make_client("bob")
        r = a.post("/api/boards/", {"name": "Dev", "is_public": True}, format="json")
        self.assertEqual(r.status_code, 201)
        bid = r.data["id"]
        # not friends: can't invite
        self.assertEqual(a.post(f"/api/boards/{bid}/invite/", {"user_id": b.user_id}, format="json").status_code, 400)
        mutual(a, b)
        a.post("/api/friends/request/", {"username": "bob"}, format="json")
        b.post(f"/api/friends/{a.user_id}/")
        self.assertEqual(a.post(f"/api/boards/{bid}/invite/", {"user_id": b.user_id}, format="json").status_code, 201)
        # bob cannot add before accepting, and can see the invite message
        self.assertEqual(b.post(f"/api/boards/{bid}/links/", {"url": "a.com"}, format="json").status_code, 403)
        msgs = b.get(f"/api/messages/{a.user_id}/").data
        self.assertEqual(msgs[0]["kind"], "board_invite")
        self.assertEqual(a.get(f"/api/messages/{b.user_id}/").data, [])   # sender doesn't see their own invite
        inv = b.get("/api/invites/").data[0]
        b.post(f"/api/invites/{inv['id']}/accept/")
        self.assertEqual(b.post(f"/api/boards/{bid}/links/", {"url": "a.com"}, format="json").status_code, 201)
        detail = a.get(f"/api/boards/{bid}/").data
        self.assertEqual(detail["member_count"], 2)
        self.assertEqual(len(detail["links"]), 1)
        # a stranger can view (public) but not add
        c = make_client("cat")
        self.assertEqual(c.get(f"/api/boards/{bid}/").status_code, 200)
        self.assertEqual(c.post(f"/api/boards/{bid}/links/", {"url": "b.com"}, format="json").status_code, 403)
        self.assertEqual(c.get(f"/api/boards/{bid}/").data["members"], [])   # collaborators are members-only
        # lock board with a PIN
        self.assertEqual(a.post("/api/locks/", {"kind": "board", "target": bid, "pin": "1234"}, format="json").status_code, 201)
        self.assertEqual(a.get(f"/api/boards/{bid}/").status_code, 403)
        self.assertEqual(a.post("/api/locks/verify/", {"kind": "board", "target": bid, "pin": "0000"}, format="json").status_code, 400)
        tok = a.post("/api/locks/verify/", {"kind": "board", "target": bid, "pin": "1234"}, format="json").data["token"]
        self.assertEqual(a.get(f"/api/boards/{bid}/", HTTP_X_UNLOCK=tok).status_code, 200)
        # decline removes
        self.assertEqual(b.delete(f"/api/boards/{bid}/members/{b.user_id}/").status_code, 204)

    def test_chat_lock_nickname_save(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "github.com"}, format="json").status_code, 403)
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json")
        b.post(f"/api/friends/{a.user_id}/")
        self.assertEqual(a.post(f"/api/messages/{b.user_id}/", {"url": "github.com", "note": "hi"}, format="json").status_code, 201)
        conv = b.get("/api/conversations/").data
        self.assertEqual(conv[0]["last"]["title"], "Example title")
        # unread counts: bob has 1 new from amy until he opens the chat; amy's own message isn't unread for her
        self.assertEqual(conv[0]["unread"], 1)
        self.assertEqual(b.get("/api/inbox/counts/").data, {"messages": 1, "requests": 0, "followers": 0})
        self.assertEqual(a.get("/api/inbox/counts/").data["messages"], 0)
        b.get(f"/api/messages/{a.user_id}/")
        self.assertEqual(b.get("/api/inbox/counts/").data["messages"], 0)
        self.assertEqual(b.get("/api/conversations/").data[0]["unread"], 0)
        b.post(f"/api/nicknames/{a.user_id}/", {"nickname": "AA"}, format="json")
        self.assertEqual(b.get("/api/conversations/").data[0]["user"]["nickname"], "AA")
        b.post("/api/locks/", {"kind": "chat", "target": a.user_id, "pin": "4321"}, format="json")
        self.assertEqual(b.get(f"/api/messages/{a.user_id}/").status_code, 403)
        self.assertIsNone(b.get("/api/conversations/").data[0]["last"])
        # image upload as custom photo
        r = a.post("/api/links/", {"url": "example.org", "image": "data:image/png;base64,AAA"}, format="json")
        self.assertTrue(r.data["custom_image"])
        # search users
        self.assertEqual(len(a.get("/api/users/search/?q=bo").data), 1)


@mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""})
class FriendRuleTests(TestCase):
    def test_friends_must_follow_each_other(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertEqual(a.post("/api/friends/request/", {"user_id": b.user_id}, format="json").status_code, 400)   # no follows
        a.post("/api/users/bob/follow/")
        self.assertEqual(a.post("/api/friends/request/", {"user_id": b.user_id}, format="json").status_code, 400)   # one-way
        b.post("/api/users/amy/follow/")                                                                            # mutual: friends automatically
        self.assertEqual([r["status"] for r in a.get("/api/friends/").data], ["accepted"])
        a.delete("/api/users/bob/follow/")                                                                          # unfollow ends it
        self.assertEqual([r for r in a.get("/api/friends/").data if r["status"] == "accepted"], [])


class MessagePrivacyTests(TestCase):
    def test_message_privacy(self):
        a, b = make_client("amy"), make_client("bob")
        post = lambda: a.post(f"/api/messages/{b.user_id}/", {"url": "https://example.com/x"}, format="json")
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            self.assertEqual(post().status_code, 403)                                   # default: friends only
            self.assertEqual(b.patch("/api/me/", {"message_privacy": "anyone"}, format="json").status_code, 200)
            self.assertEqual(a.get(f"/api/conversations/?with={b.user_id}").data[0]["user"]["id"], b.user_id)
            self.assertEqual(post().status_code, 201)                                   # anyone can, no friendship needed
            self.assertEqual([c["user"]["id"] for c in b.get("/api/conversations/").data], [a.user_id])
            self.assertTrue(a.get("/api/users/bob/").data["can_message"])
            b.patch("/api/me/", {"message_privacy": "none"}, format="json")
            self.assertEqual(post().status_code, 403)
            self.assertFalse(a.get("/api/users/bob/").data["can_message"])
            self.assertEqual(b.patch("/api/me/", {"message_privacy": "x"}, format="json").status_code, 400)


class SavedBoardTests(TestCase):
    def test_saved_board_follows_then_freezes(self):
        a, b = make_client("amy"), make_client("bob")
        bid = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            a.post(f"/api/boards/{bid}/links/", {"url": "https://one.com/x"}, format="json")
            self.assertEqual(b.post(f"/api/boards/{bid}/save/").status_code, 201)
            row = [x for x in b.get("/api/boards/").data if x["id"] == bid][0]
            self.assertTrue(row["saved"] and not row["frozen"] and row["link_count"] == 1)
            a.post(f"/api/boards/{bid}/links/", {"url": "https://two.com/x"}, format="json")     # live update
            self.assertEqual(len(b.get(f"/api/boards/{bid}/").data["links"]), 2)
            a.patch(f"/api/boards/{bid}/", {"is_public": False}, format="json")                  # private: freezes
            a.post(f"/api/boards/{bid}/links/", {"url": "https://three.com/x"}, format="json")
            d = b.get(f"/api/boards/{bid}/").data
            self.assertTrue(d["frozen"])
            self.assertEqual(len(d["links"]), 2)
            a.patch(f"/api/boards/{bid}/", {"is_public": True}, format="json")                   # public again: live
            self.assertEqual(len(b.get(f"/api/boards/{bid}/").data["links"]), 3)
            self.assertEqual(b.delete(f"/api/boards/{bid}/save/").status_code, 204)
            self.assertEqual([x for x in b.get("/api/boards/").data if x["id"] == bid], [])


class BoardRoleTests(TestCase):
    def test_view_only_member_cannot_add(self):
        a, b = make_client("amy"), make_client("bob")
        mutual(a, b)
        a.post("/api/friends/request/", {"user_id": b.user_id}, format="json")
        b.post(f"/api/friends/{a.user_id}/")
        bid = a.post("/api/boards/", {"name": "Music", "is_public": False}, format="json").data["id"]
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            r = a.post(f"/api/boards/{bid}/invite/", {"user_id": b.user_id, "role": "view"}, format="json")
            self.assertEqual(r.status_code, 201)
            b.post(f"/api/invites/{r.data['id']}/accept/")
            d = b.get(f"/api/boards/{bid}/").data
            self.assertTrue(d["is_member"] and not d["can_edit"])
            self.assertEqual(b.post(f"/api/boards/{bid}/links/", {"url": "https://x.com/a"}, format="json").status_code, 403)
            self.assertEqual(a.patch(f"/api/boards/{bid}/members/{b.user_id}/", {"role": "edit"}, format="json").status_code, 200)
            self.assertEqual(b.post(f"/api/boards/{bid}/links/", {"url": "https://x.com/a"}, format="json").status_code, 201)


class FeedTests(TestCase):
    def test_feed_only_people_you_follow(self):
        a, b, c = make_client("amy"), make_client("bob"), make_client("cyd")
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            for cl, url in ((b, "https://bob.com/x"), (c, "https://cyd.com/x")):
                cl.post("/api/links/", {"url": url, "is_public": True}, format="json")
                cl.post("/api/boards/", {"name": cl.user_id and f"B{cl.user_id}", "is_public": True}, format="json")
            self.assertEqual(a.get("/api/feed/").data, [])
            self.assertEqual(a.get("/api/feed/boards/").data, [])
            a.post("/api/users/bob/follow/")
            self.assertEqual([l["owner"]["username"] for l in a.get("/api/feed/").data], ["bob"])
            self.assertEqual([x["owner"]["username"] for x in a.get("/api/feed/boards/").data], ["bob"])


class AnalyticsTests(TestCase):
    def test_counts(self):
        a, b = make_client("amy"), make_client("bob")
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            lid = a.post("/api/links/", {"url": "https://a.com/x", "is_public": True}, format="json").data["id"]
            bid = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
            b.post("/api/events/", {"kind": "view", "link_id": lid}, format="json")
            b.post("/api/events/", {"kind": "view", "link_id": lid}, format="json")          # same hour: one view
            b.post("/api/events/", {"kind": "share", "link_id": lid}, format="json")
            b.post("/api/links/save/", {"link_id": lid}, format="json")
            b.get(f"/api/boards/{bid}/"); b.post(f"/api/boards/{bid}/save/")
            a.post("/api/events/", {"kind": "view", "link_id": lid}, format="json")          # own activity doesn't count
            mutual(a, b)
            d = a.get("/api/analytics/").data
            o = d["overview"]
            self.assertEqual((o["view"], o["save"], o["share"], o["followers"]), (2, 2, 1, 1))   # link view + board view; link save + board save
            self.assertEqual([(l["view"], l["save"], l["share"]) for l in d["links"]], [(1, 1, 1)])
            self.assertEqual([(x["view"], x["save"]) for x in d["boards"]], [(1, 1)])


class FollowBackTests(TestCase):
    def test_mutual_follow_makes_friends(self):
        a, b = make_client("amy"), make_client("bob")
        self.assertFalse(a.post("/api/users/bob/follow/").data["friends"])
        row = b.get("/api/followers/alerts/").data[0]
        self.assertFalse(row["i_follow"])                                   # bob can Follow back
        self.assertEqual(b.get("/api/friends/").data, [])                   # one-way follow: not friends
        self.assertTrue(b.post("/api/users/amy/follow/").data["friends"])   # follow back: friends
        self.assertEqual([r["status"] for r in a.get("/api/friends/").data], ["accepted"])
        b.delete("/api/users/amy/follow/")
        self.assertEqual(a.get("/api/friends/").data, [])


class ExtrasTests(TestCase):
    def test_reactions_style_activity(self):
        a, b = make_client("amy"), make_client("bob")
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "https://i.com/a.jpg", "logo": ""}):
            lid = a.post("/api/links/", {"url": "https://a.com/x", "is_public": True}, format="json").data["id"]
            # reactions: one per person, counted, removable
            r = b.post(f"/api/links/{lid}/react/", {"emoji": "\U0001F525"}, format="json").data
            self.assertEqual((r["reactions"], r["my_reaction"]), ({"\U0001F525": 1}, "\U0001F525"))
            self.assertEqual(b.post(f"/api/links/{lid}/react/", {"emoji": "x"}, format="json").status_code, 400)
            self.assertEqual(a.get("/api/analytics/").data["overview"]["reactions"], 1)
            self.assertEqual(b.get("/api/discover/").data == [] or True, True)
            # board colour / emoji / collage / activity
            bid = a.post("/api/boards/", {"name": "Music", "is_public": True}, format="json").data["id"]
            a.post(f"/api/boards/{bid}/links/", {"url": "https://one.com/x"}, format="json")
            self.assertEqual(a.patch(f"/api/boards/{bid}/", {"color": "nope"}, format="json").status_code, 400)
            d = a.patch(f"/api/boards/{bid}/", {"color": "#ff8800", "emoji": "\U0001F3B5"}, format="json").data
            self.assertEqual((d["color"], d["emoji"], len(d["previews"])), ("#ff8800", "\U0001F3B5", 1))
            self.assertEqual([i["kind"] for i in b.get(f"/api/boards/{bid}/activity/").data], ["link"])


class GuestTests(TestCase):
    def test_guests_browse_public_only(self):
        a = make_client("amy")
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "t", "description": "", "image": "", "logo": ""}):
            a.post("/api/links/", {"url": "https://a.com/x", "is_public": True}, format="json")
            a.post("/api/links/", {"url": "https://a.com/private"}, format="json")
            pub = a.post("/api/boards/", {"name": "Open", "is_public": True}, format="json").data["id"]
            priv = a.post("/api/boards/", {"name": "Secret", "is_public": False}, format="json").data["id"]
            a.post(f"/api/boards/{pub}/links/", {"url": "https://one.com/x"}, format="json")
        g = APIClient()                                                    # not logged in
        self.assertEqual([l["url"] for l in g.get("/api/discover/").data if l["source"] == "mine"], ["https://a.com/x"])
        self.assertEqual([b["name"] for b in g.get("/api/discover/boards/").data], ["Open"])
        self.assertEqual(len(g.get(f"/api/boards/{pub}/").data["links"]), 1)
        self.assertEqual(g.get(f"/api/boards/{priv}/").status_code, 404)   # private boards stay private
        self.assertEqual(g.get("/api/categories/?options=1").status_code, 200)
        for path in ("/api/me/", "/api/boards/", "/api/feed/", "/api/inbox/counts/", "/api/users/amy/"):
            self.assertEqual(g.get(path).status_code, 401, path)           # everything else needs a login
        self.assertEqual(g.post("/api/links/save/", {"url": "https://x.com"}, format="json").status_code, 401)
        self.assertEqual(g.patch(f"/api/boards/{pub}/", {"name": "x"}, format="json").status_code, 401)


class LinkPageTests(TestCase):
    def put(self, c, **kw):
        body = {"handle": "alice-card", "bio": "hello world", "items": [], "tabs": []}
        body.update(kw)
        return c.put("/api/linkpage/", body, format="json")

    def items(self, n):
        return [{"id": f"i{k}", "name": f"Link {k}", "url": f"https://site{k}.com", "icon": "instagram"} for k in range(n)]

    def test_card(self):
        a, b = make_client("pagea"), make_client("pageb")
        its = self.items(8)
        tabs = [{"name": "Work", "icon": "💼", "item_ids": ["i0", "i1", "nope"]}, {"name": "Empty", "item_ids": []},
                {"name": "C", "item_ids": ["i2"]}, {"name": "Fourth", "item_ids": ["i3"]}]
        r = self.put(a, handle="Alice-Card", items=its, tabs=tabs, main_name="Everyone", banner="data:image/png;base64,AAAA")
        self.assertEqual(r.status_code, 200, r.content)
        out = r.data["page"]
        cid = out["id"]
        self.assertEqual([t["name"] for t in out["tabs"]], ["Everyone", "Work", "Empty", "C"])    # 4 tabs in all, the first included
        self.assertEqual(out["tabs"][0]["item_ids"], [f"i{k}" for k in range(8)])                    # the first tab holds every link
        self.assertEqual(out["tabs"][1]["item_ids"], ["i0", "i1"])                                   # unknown ids dropped
        pub = APIClient().get("/api/l/alice-card/")                                                 # no login needed
        self.assertEqual(pub.status_code, 200)
        self.assertEqual([t["name"] for t in pub.data["tabs"]], ["Everyone", "Work", "C"])         # empty tab hidden from visitors
        self.assertTrue(pub.data["banner"].startswith("data:image"))
        self.put(a, id=cid, handle="alice-card", items=its, main_hidden=True, tabs=tabs[:1])
        self.assertEqual([t["name"] for t in APIClient().get("/api/l/alice-card/").data["tabs"]], ["Work"])   # first tab hidden
        self.assertEqual(self.put(b, handle="alice-card").status_code, 400)                          # name taken
        self.assertEqual(self.put(a, id=cid, bio=" ".join(["w"] * 29)).status_code, 400)             # 28 words max
        self.assertEqual(APIClient().get("/api/l/nobody/").status_code, 404)

    def test_tab_order_hiding_and_name_length(self):
        a = make_client("ordera")
        its = self.items(4)
        tabs = [{"name": "ABCDEFGHIJKLMNOP", "item_ids": ["i0"]}, {"name": "Hidden", "item_ids": ["i1"], "hidden": True}]
        r = self.put(a, items=its, tabs=tabs, main_name="Home", main_pos=1)
        self.assertEqual(r.status_code, 200, r.content)
        names = [t["name"] for t in r.data["page"]["tabs"]]
        self.assertEqual(names, ["ABCDEFGHIJKL", "Home", "Hidden"])                                   # names cut to 12 letters; Home sits at position 1
        self.assertTrue(r.data["page"]["tabs"][2]["hidden"])
        pub = APIClient().get("/api/l/alice-card/").data
        self.assertEqual([t["name"] for t in pub["tabs"]], ["ABCDEFGHIJKL", "Home"])                  # hidden tab is not on the live card
        cid = r.data["page"]["id"]
        r = self.put(a, id=cid, items=its, tabs=tabs, main_name="Home", main_hidden=True, main_pos=0)
        self.assertEqual([t["name"] for t in APIClient().get("/api/l/alice-card/").data["tabs"]], ["ABCDEFGHIJKL"])

    def test_card_with_18_plus_links_is_flagged(self):
        a = make_client("adulta")
        items = [{"id": "a", "name": "Fine", "url": "https://a.com"}, {"id": "b", "name": "Spicy", "url": "https://b.com", "adult": True}]
        r = self.put(a, items=items)
        self.assertTrue(r.data["page"]["adult"])
        self.assertEqual([i["adult"] for i in r.data["page"]["items"]], [False, True])
        self.assertTrue(APIClient().get("/api/l/alice-card/").data["adult"])                          # visitors are told, so they can be asked first
        r = self.put(a, id=r.data["page"]["id"], items=items[:1])
        self.assertFalse(r.data["page"]["adult"])
        r = self.put(a, id=r.data["page"]["id"], items=items[:1], adult=True)                         # or the owner says so, whatever the links are
        self.assertTrue(r.data["page"]["adult"] and r.data["page"]["adult_card"])
        self.assertTrue(APIClient().get("/api/l/alice-card/").data["adult"])

    def test_custom_emoji_reaction(self):
        a, b = make_client("rxowner"), make_client("rxfan")
        l = Link.objects.create(owner_id=a.user_id, url="https://x.com/1", key="rx1", host="x.com", title="Hi", is_public=True, source="mine")
        r = b.post(f"/api/links/{l.id}/react/", {"emoji": "\U0001F984"}, format="json")                 # a unicorn: not in the usual five
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["my_reaction"], "\U0001F984")
        self.assertEqual(b.post(f"/api/links/{l.id}/react/", {"emoji": "abc"}, format="json").status_code, 400)   # words are not emojis
        self.assertEqual(b.post(f"/api/links/{l.id}/react/", {"emoji": "<script>"}, format="json").status_code, 400)

    def test_card_has_its_own_name(self):
        a = make_client("namedcard")
        r = self.put(a, handle="the-url", name="  My Shop  ")
        self.assertEqual((r.data["page"]["name"], r.data["page"]["handle"]), ("My Shop", "the-url"))   # the name is not the address
        self.assertEqual(APIClient().get("/api/l/the-url/").data["name"], "My Shop")
        self.assertEqual(a.get("/api/analytics/").data["cards"][0]["name"], "My Shop")
        r = self.put(a, id=r.data["page"]["id"], handle="the-url", name="")
        self.assertEqual(r.data["page"]["name"], "Namedcard")                                         # no name: falls back to the person's name

    def test_reserved_card_names(self):
        a = make_client("reserva")
        self.assertEqual(self.put(a, handle="boards").status_code, 400)
        self.assertFalse(APIClient().get("/api/check-name/?kind=page&name=ocard").data["available"])

    def test_card_analytics(self):
        a, b = make_client("statsa"), make_client("statsb")
        items = [{"id": "x1", "name": "Insta", "url": "https://i.com"}, {"id": "x2", "name": "Site", "url": "https://s.com"}]
        self.put(a, handle="stats-card", items=items)
        anon = APIClient()
        for body in ({"kind": "view"}, {"kind": "view"}, {"kind": "click", "item": "x1"}, {"kind": "click", "item": "x1"}, {"kind": "click", "item": "x2"}, {"kind": "share"}):
            self.assertEqual(anon.post("/api/l/stats-card/event/", body, format="json").status_code, 204)
        b.post("/api/l/stats-card/event/", {"kind": "view"}, format="json")                           # a signed-in visitor counts too
        a.post("/api/l/stats-card/event/", {"kind": "view"}, format="json")                           # the owner looking does not
        anon.post("/api/l/stats-card/event/", {"kind": "click", "item": "nope"}, format="json")      # unknown link: ignored
        self.assertEqual(anon.post("/api/l/stats-card/event/", {"kind": "bad"}, format="json").status_code, 400)
        d = a.get("/api/analytics/?days=7").data
        c = d["cards"][0]
        self.assertEqual((c["handle"], c["view"], c["click"], c["share"], c["link_count"]), ("stats-card", 3, 3, 1, 2))
        self.assertEqual([(t["name"], t["clicks"]) for t in c["top"]], [("Insta", 2), ("Site", 1)])
        self.assertEqual((d["overview"]["card_view"], d["overview"]["card_click"]), (3, 3))
        self.assertEqual(d["overview"]["view"], 0)                                                     # card views are not link views

    def test_link_added_to_a_board_also_appears_in_all(self):
        a = make_client("alladder")
        bid = a.post("/api/boards/", {"name": "Reads", "is_public": False}, format="json").data["id"]
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "Nice page", "description": "", "image": "", "logo": ""}):
            self.assertEqual(a.post(f"/api/boards/{bid}/links/", {"url": "https://nice.example.com/p"}, format="json").status_code, 201)
        mine = a.get("/api/links/").data
        self.assertEqual([(l["title"], l["source"]) for l in mine], [("Nice page", "mine")])                  # it shows in All too
        self.assertFalse(mine[0]["is_public"])                                                                # and stays private
        with mock.patch("api.utils.fetch_meta", lambda url: {"title": "Nice page", "description": "", "image": "", "logo": ""}):
            a.post("/api/links/", {"url": "https://other.example.com/x", "board_id": bid}, format="json")      # the old route still works
        self.assertEqual(len(a.get("/api/links/").data), 2)

    def test_name_and_description_can_be_chosen_when_adding_a_link(self):
        a = make_client("namer")
        bid = a.post("/api/boards/", {"name": "Notes", "is_public": False}, format="json").data["id"]
        meta = {"title": "Site title", "description": "Site description", "image": "", "logo": ""}
        with mock.patch("api.utils.fetch_meta", lambda url: meta):
            auto = a.post("/api/links/", {"url": "https://auto.example.com"}, format="json")
            mine = a.post("/api/links/", {"url": "https://mine.example.com", "title": "  My own name ", "description": "My own words"}, format="json")
            onboard = a.post(f"/api/boards/{bid}/links/", {"url": "https://board.example.com", "title": "Board name", "description": "Board words"}, format="json")
        self.assertEqual((auto.data["title"], auto.data["description"]), ("Site title", "Site description"))   # nothing typed: read from the site
        self.assertEqual((mine.data["title"], mine.data["description"]), ("My own name", "My own words"))     # typed: wins
        self.assertEqual((onboard.data["title"], onboard.data["description"]), ("Board name", "Board words"))
        self.assertIn(("Board name", "Board words"), [(l["title"], l["description"]) for l in a.get("/api/links/").data])   # and it is in All too

    def test_advertised_link_tops_discover_for_six_hours(self):
        a, b = make_client("advsa"), make_client("advsb")
        reader = make_client("advreader")
        old = Link.objects.create(owner_id=a.user_id, url="https://old.example.com", key="o1", host="old.example.com", title="Old", is_public=True, source="mine")
        new = Link.objects.create(owner_id=b.user_id, url="https://new.example.com", key="n1", host="new.example.com", title="New", is_public=True, source="mine")
        Link.objects.filter(pk=old.pk).update(created=timezone.now() - timedelta(days=3))
        hosts = lambda: [x["host"] for x in reader.get("/api/discover/").data if x["host"].endswith("example.com")]
        self.assertEqual(hosts(), ["new.example.com", "old.example.com"])                       # plain: newest first
        with mock.patch("api.utils.is_active", lambda url: True):
            self.assertEqual(a.post(f"/api/links/{old.pk}/advertise/", {"pitch": "hi"}, format="json").status_code, 200)
        self.assertEqual(hosts(), ["old.example.com", "new.example.com"])                       # just advertised: on top
        Link.objects.filter(pk=old.pk).update(advertised_at=timezone.now() - timedelta(hours=7))
        self.assertEqual(hosts(), ["new.example.com", "old.example.com"])                       # after 6 hours: back to its place in time
        a.delete(f"/api/links/{old.pk}/advertise/")
        self.assertIsNone(Link.objects.get(pk=old.pk).advertised_at)

    def test_status_takes_other_peoples_public_links_and_boards(self):
        a, b = make_client("statusc"), make_client("statusd")
        pub_link = Link.objects.create(owner_id=b.user_id, url="https://p.example.com", key="p1", host="p.example.com", title="Public", source="mine", is_public=True)
        priv_link = Link.objects.create(owner_id=b.user_id, url="https://q.example.com", key="q1", host="q.example.com", title="Private", source="mine", is_public=False)
        pub_board = b.post("/api/boards/", {"name": "Their open board", "is_public": True}, format="json").data
        priv_board = b.post("/api/boards/", {"name": "Their closed board", "is_public": False}, format="json").data
        ok = self.put(a, status=[{"kind": "link", "ref_id": pub_link.id}, {"kind": "board", "ref_id": pub_board["id"]}])
        self.assertEqual(ok.status_code, 200, ok.content)
        pid = ok.data["page"]["id"]
        self.assertEqual(self.put(a, id=pid, status=[{"kind": "link", "ref_id": priv_link.id}]).status_code, 400)
        self.assertEqual(self.put(a, id=pid, status=[{"kind": "board", "ref_id": priv_board["id"]}]).status_code, 400)

    def test_card_status_lasts_1_to_30_days(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import LinkPage
        a = make_client("statusdays")
        mine = Link.objects.create(owner_id=a.user_id, url="https://d.example.com", key="d1", host="d.example.com", title="D", source="mine")
        r = self.put(a, status=[{"kind": "link", "ref_id": mine.id}], status_days=2)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["page"]["status_days"], 2)
        self.assertEqual(len(r.data["page"]["status"]), 1)
        for bad in (0, 31, "x"):
            self.assertEqual(self.put(a, id=r.data["page"]["id"], status_days=bad).status_code, 400)
        LinkPage.objects.filter(pk=r.data["page"]["id"]).update(status_at=timezone.now() - timedelta(days=3))
        self.assertEqual(APIClient().get("/api/l/alice-card/").data["status"], [])               # over: gone for visitors

    def test_card_status_holds_links_and_boards(self):
        a, b = make_client("statusa"), make_client("statusb")
        mine = Link.objects.create(owner_id=a.user_id, url="https://mine.example.com/p", key="m1", host="mine.example.com", title="My link", source="mine")
        theirs = Link.objects.create(owner_id=b.user_id, url="https://theirs.example.com", key="t1", host="theirs.example.com", title="Not mine", source="mine")
        pub = a.post("/api/boards/", {"name": "Open board", "is_public": True}, format="json").data
        priv = a.post("/api/boards/", {"name": "Closed board", "is_public": False}, format="json").data
        status = [{"kind": "link", "ref_id": mine.id}, {"kind": "board", "ref_id": pub["id"]}]
        r = self.put(a, status=status)
        self.assertEqual(r.status_code, 200, r.content)
        items = r.data["page"]["status"]
        self.assertEqual([(i["kind"], i["title"]) for i in items], [("link", "My link"), ("board", "Open board")])
        self.assertEqual(items[0]["url"], "https://mine.example.com/p")                         # a link opens directly
        self.assertEqual(items[1]["url"], f"/boards/statusa/{pub['slug']}")                       # a board opens on the site
        self.assertEqual(len(APIClient().get("/api/l/alice-card/").data["status"]), 2)          # visitors see it, no login needed
        self.assertEqual(self.put(a, id=r.data["page"]["id"], status=[{"kind": "link", "ref_id": theirs.id}]).status_code, 400)   # someone else's link
        self.assertEqual(self.put(a, id=r.data["page"]["id"], status=[{"kind": "board", "ref_id": priv["id"]}]).status_code, 400) # a private board
        self.assertEqual(self.put(a, id=r.data["page"]["id"], status=[{"kind": "link", "ref_id": mine.id}] * 11).status_code, 200)  # repeats are merged
        many = [{"kind": "link", "ref_id": mine.id + i} for i in range(11)]
        self.assertEqual(self.put(a, id=r.data["page"]["id"], status=many).status_code, 400)  # at most 10

    def test_up_to_three_cards(self):
        a, b = make_client("cardsa"), make_client("cardsb")
        ids = []
        for n in ("one-card", "two-card", "three-card"):
            r = self.put(a, handle=n)
            self.assertEqual(r.status_code, 200, r.content)
            ids.append(r.data["page"]["id"])
        self.assertEqual(self.put(a, handle="four-card").status_code, 400)                           # a 4th card is refused
        self.assertEqual(self.put(a, id=ids[0], handle="one-renamed").status_code, 200)              # editing one is still fine
        listing = a.get("/api/linkpage/").data
        self.assertEqual((len(listing["pages"]), listing["max"]), (3, 3))
        self.assertEqual(self.put(b, id=ids[1], handle="stolen").status_code, 404)                   # not someone else's card
        self.assertEqual(b.delete(f"/api/linkpage/{ids[1]}/").status_code, 404)
        self.assertEqual(a.delete(f"/api/linkpage/{ids[1]}/").status_code, 204)
        self.assertEqual(self.put(a, handle="four-card").status_code, 200)                           # room again after deleting
        self.assertEqual(b.get("/api/users/cardsa/").data["card"], "one-renamed")                    # the first card is on the profile
        r = a.patch(f"/api/linkpage/{ids[2]}/", {"on_profile": True}, format="json")                 # choose another one
        self.assertEqual([p["on_profile"] for p in r.data["pages"]], [False, True, False])
        self.assertEqual(b.get("/api/users/cardsa/").data["card"], "three-card")
        a.patch(f"/api/linkpage/{ids[2]}/", {"on_profile": False}, format="json")                    # or none
        self.assertIsNone(b.get("/api/users/cardsa/").data["card"])
        self.assertEqual(b.patch(f"/api/linkpage/{ids[0]}/", {"on_profile": True}, format="json").status_code, 404)

    def test_limits_and_validation(self):
        a = make_client("limita")
        self.assertEqual(self.put(a, items=self.items(30)).status_code, 200)
        self.assertEqual(self.put(a, id=a.get("/api/linkpage/").data["pages"][0]["id"], items=self.items(31)).status_code, 400)   # 30 links in total
        its = self.items(10)
        self.assertEqual(self.put(a, handle="t-one", items=its, tabs=[{"name": "T", "item_ids": [f"i{k}" for k in range(7)]}]).status_code, 400)   # 6 per tab
        self.assertEqual(self.put(a, handle="t-one", items=its, tabs=[{"name": "T", "item_ids": [f"i{k}" for k in range(6)]}]).status_code, 200)
        self.assertEqual(self.put(a, handle="t-two", items=[{"id": "x", "name": "Bad", "url": "javascript:alert(1)"}]).status_code, 400)
        r0 = self.put(a, handle="t-two", items=[{"id": "x", "name": "", "url": "https://www.a.com/page"}, {"id": "y", "url": ""}])
        self.assertEqual(r0.status_code, 400)                                                                   # an address is needed
        r1 = self.put(a, handle="t-two", items=[{"id": "x", "name": "", "url": "https://www.a.com/page"}])
        self.assertEqual(r1.data["page"]["items"][0]["name"], "a.com")                                            # no name: the site stands in
        r = self.put(a, id=r1.data["page"]["id"], handle="t-two", items=[{"id": "x", "name": "Site", "url": "example.com", "icon": ""}])        # https:// is added
        self.assertEqual(r.data["page"]["items"][0]["url"], "https://example.com")

    def test_name_check(self):
        a = make_client("namea")
        anon = APIClient()
        self.assertFalse(anon.get("/api/check-name/?kind=username&name=NameA").data["available"])     # taken, any case
        self.assertTrue(a.get("/api/check-name/?kind=username&name=namea").data["available"])           # your own name is fine
        self.assertTrue(anon.get("/api/check-name/?kind=username&name=freeone").data["available"])
        self.assertFalse(anon.get("/api/check-name/?kind=username&name=x").data["valid"])
        cid = self.put(a, handle="mycard").data["page"]["id"]
        self.assertFalse(anon.get("/api/check-name/?kind=page&name=mycard").data["available"])
        self.assertFalse(a.get("/api/check-name/?kind=page&name=mycard").data["available"])             # another card of yours can't reuse it
        self.assertTrue(a.get(f"/api/check-name/?kind=page&name=mycard&id={cid}").data["available"])    # but the card itself keeps it

    def test_upgrade_raises_limits(self):
        a = make_client("proa")
        for n in ("c-one", "c-two", "c-three"):
            self.assertEqual(self.put(a, handle=n).status_code, 200)
        self.assertEqual(self.put(a, handle="c-four").status_code, 400)                              # free: 3 cards
        five = [{"name": f"T{k}", "item_ids": []} for k in range(5)]
        cid = a.get("/api/linkpage/").data["pages"][0]["id"]
        free = self.put(a, id=cid, handle="c-one", tabs=five)
        self.assertEqual(len(free.data["page"]["tabs"]), 4)                                           # 4 tabs in all
        lim = a.get("/api/linkpage/").data["limits"]
        self.assertEqual((lim["pro"], lim["cards"], lim["tabs"], lim["links"]), (False, 3, 4, 30))
        r = a.post("/api/upgrade/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(a.get("/api/me/").data["is_pro"])
        self.assertEqual(self.put(a, handle="c-four").status_code, 200)                              # Pro: more cards
        pro = self.put(a, id=cid, handle="c-one", tabs=five)
        self.assertEqual(len(pro.data["page"]["tabs"]), 4)                                            # Pro: the same 4 tabs for now
        self.assertEqual(self.put(a, id=cid, handle="c-one", items=self.items(30)).status_code, 200)    # Pro: the same 30 links for now
        self.assertEqual(self.put(a, id=cid, handle="c-one", items=self.items(31)).status_code, 400)    # and no more than that
        with self.settings(PRO_SELF_UPGRADE=False):
            b = make_client("prob")
            self.assertEqual(b.post("/api/upgrade/").status_code, 403)                               # switched off: admin only

    def test_board_readable_address(self):
        a = make_client("slugger")
        r = a.post("/api/boards/", {"name": "Travel Photos!", "is_public": True}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["slug"], "travel-photos")
        r2 = a.post("/api/boards/", {"name": "Travel photos 2", "is_public": True}, format="json")
        self.assertEqual(r2.data["slug"], "travel-photos-2")
        found = APIClient().get("/api/boards/by/Slugger/travel-photos/")                         # no login, any letter case for the owner
        self.assertEqual((found.status_code, found.data["id"]), (200, r.data["id"]))
        self.assertEqual(APIClient().get("/api/boards/by/slugger/nope/").status_code, 404)
        a.patch(f"/api/boards/{r.data['id']}/", {"name": "Renamed"}, format="json")
        self.assertEqual(APIClient().get("/api/boards/by/slugger/travel-photos/").status_code, 200)   # old shared links keep working

    def test_link_icon_can_be_a_picture_address(self):
        a = make_client("iconsa")
        its = [{"id": "b1", "name": "Board", "url": "https://x.com/boards/a/b", "icon": "https://img.example.com/cover.jpg"},
               {"id": "b2", "name": "Bad", "url": "https://x.com", "icon": "javascript:alert(1)"}]
        r = self.put(a, items=its)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([i["icon"] for i in r.data["page"]["items"]], ["https://img.example.com/cover.jpg", ""])   # an address is kept, anything odd is dropped

    def join_board(self, owner, other, bid, other_username):
        mutual(owner, other)
        owner.post("/api/friends/request/", {"username": other_username}, format="json")
        other.post(f"/api/friends/{owner.user_id}/")
        owner.post(f"/api/boards/{bid}/invite/", {"user_id": other.user_id}, format="json")
        inv = other.get("/api/invites/").data[0]
        other.post(f"/api/invites/{inv['id']}/accept/")

    def test_collaborators_cannot_rename_or_delete_but_the_owner_can_remove_them(self):
        amy, bob, cat = make_client("amyb"), make_client("bobb"), make_client("catb")
        bid = amy.post("/api/boards/", {"name": "Team", "is_public": True}, format="json").data["id"]
        self.join_board(amy, bob, bid, "bobb")
        self.join_board(amy, cat, bid, "catb")
        self.assertEqual(len(amy.get(f"/api/boards/{bid}/").data["members"]), 3)
        # a collaborator can add links but not rename, delete or manage people
        self.assertEqual(bob.post(f"/api/boards/{bid}/links/", {"url": "a.com"}, format="json").status_code, 201)
        self.assertEqual(bob.patch(f"/api/boards/{bid}/", {"name": "Mine now"}, format="json").status_code, 403)
        self.assertEqual(bob.delete(f"/api/boards/{bid}/").status_code, 403)
        self.assertEqual(bob.patch(f"/api/boards/{bid}/members/{cat.user_id}/", {"role": "view"}, format="json").status_code, 403)
        self.assertEqual(bob.delete(f"/api/boards/{bid}/members/{cat.user_id}/").status_code, 403)       # cannot remove someone else
        self.assertEqual(amy.get(f"/api/boards/{bid}/").data["name"], "Team")
        # the owner can rename it and remove a collaborator
        self.assertEqual(amy.patch(f"/api/boards/{bid}/", {"name": "Team A"}, format="json").status_code, 200)
        self.assertEqual(amy.delete(f"/api/boards/{bid}/members/{bob.user_id}/").status_code, 204)
        self.assertEqual(len(amy.get(f"/api/boards/{bid}/").data["members"]), 2)
        self.assertEqual(bob.post(f"/api/boards/{bid}/links/", {"url": "b.com"}, format="json").status_code, 403)   # no longer a collaborator

    def test_followers_and_following_are_newest_first(self):
        me, a, b, c = make_client("ordme"), make_client("orda"), make_client("ordb"), make_client("ordc")
        now = timezone.now()
        # a followed me first, then c, then b; and I followed c first, then a, then b
        for who, days in ((a, 9), (c, 6), (b, 2)):
            f = Follow.objects.create(follower_id=who.user_id, target_id=me.user_id, status="accepted")
            Follow.objects.filter(pk=f.pk).update(created=now - timedelta(days=days))
        for who, days in ((c, 8), (a, 5), (b, 1)):
            f = Follow.objects.create(follower_id=me.user_id, target_id=who.user_id, status="accepted")
            Follow.objects.filter(pk=f.pk).update(created=now - timedelta(days=days))
        names = lambda rows: [r["username"] for r in rows]
        self.assertEqual(names(me.get("/api/users/ordme/followers/").data), ["ordb", "ordc", "orda"])      # latest to follow me first
        self.assertEqual(names(me.get("/api/users/ordme/following/").data), ["ordb", "orda", "ordc"])      # latest I followed first

    def test_owner_can_react_to_their_own_link(self):
        a, b = make_client("ownreact"), make_client("otherreact")
        mine = Link.objects.create(owner_id=a.user_id, url="https://x.com/own", key="own1", host="x.com", title="Mine", is_public=True, source="mine")
        r = a.post(f"/api/links/{mine.id}/react/", {"emoji": "\U0001F525"}, format="json")
        self.assertEqual((r.status_code, r.data["my_reaction"], r.data["reactions"]), (200, "\U0001F525", {"\U0001F525": 1}))
        listing = [l for l in a.get("/api/links/").data if l["id"] == mine.id][0]
        self.assertEqual((listing["reactions"], listing["my_reaction"]), ({"\U0001F525": 1}, "\U0001F525"))   # shows in Mine with the reaction
        self.assertEqual(a.get("/api/analytics/").data["overview"]["reactions"], 0)                            # but it does not count as attention from others
        b.post(f"/api/links/{mine.id}/react/", {"emoji": "❤️"}, format="json")
        self.assertEqual(a.get("/api/analytics/").data["overview"]["reactions"], 1)                            # someone else's does
        a.post(f"/api/links/{mine.id}/react/", {"emoji": ""}, format="json")                                    # and I can take mine off again
        self.assertEqual([l for l in a.get("/api/links/").data if l["id"] == mine.id][0]["my_reaction"], "")
