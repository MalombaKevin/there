from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views, views_admin as adm, views_auth as a, views_pages as pg

urlpatterns = [
    path("health/", views.health),
    # auth
    path("auth/register/", a.register), path("auth/login/", a.login), path("auth/google/", a.google_login),
    path("auth/refresh/", TokenRefreshView.as_view()),
    # me & users
    path("me/", views.me), path("categories/", views.categories), path("users/search/", views.user_search),
    path("users/<str:username>/", views.profile),
    path("users/<str:username>/follow/", views.follow),
    path("users/<str:username>/<str:which>/", views.follow_lists),
    path("follow-requests/", views.follow_requests), path("followers/alerts/", views.follower_alerts), path("follow-requests/<int:pk>/<str:action>/", views.follow_request_respond),
    # links
    path("links/", views.links), path("links/save/", views.save_link), path("links/<int:pk>/", views.link_detail),
    path("links/<int:pk>/advertise/", views.advertise), path("links/<int:pk>/react/", views.link_react), path("links/<int:pk>/stats/", views.link_stats), path("boards/links/<int:lid>/react/", views.board_link_react), path("boards/<int:pk>/stats/", views.board_stats),
    path("boards/<int:pk>/activity/", views.board_activity),
    path("preview/", views.preview), path("check-url/", views.check_url), path("discover/", views.discover),
    # boards
    path("discover/boards/", views.discover_boards), path("feed/", views.feed), path("events/", views.log_event), path("analytics/", views.analytics), path("feed/boards/", views.feed_boards), path("boards/", views.boards), path("boards/by/<str:username>/<str:slug>/", views.board_by_name), path("boards/<int:pk>/", views.board_detail), path("boards/<int:pk>/save/", views.board_save),
    path("boards/<int:pk>/links/", views.board_add_link), path("boards/<int:pk>/pin/", views.board_pin),
    path("boards/<int:pk>/links/<int:lid>/", views.board_link_detail),
    path("boards/<int:pk>/invite/", views.board_invite), path("boards/<int:pk>/members/<int:uid>/", views.board_member),
    path("invites/", views.invites), path("invites/<int:pk>/<str:action>/", views.invite_respond),
    # friends & chat
    path("friends/", views.friends), path("friends/request/", views.friend_request), path("friends/suggestions/", views.friend_suggestions), path("friends/<int:uid>/", views.friend_detail),
    path("conversations/", views.conversations), path("inbox/counts/", views.inbox_counts), path("messages/<int:uid>/", views.messages), path("messages/<int:uid>/<int:mid>/", views.message_detail), path("messages/<int:uid>/<int:mid>/open/", views.message_open),
    path("nicknames/<int:uid>/", views.nickname),
    # blocks & locks
    path("blocks/", views.blocks), path("blocks/<int:uid>/", views.unblock),
    # My Links page
    path("shortlinks/", views.shortlinks), path("shortlinks/<int:pk>/", views.shortlink_detail), path("s/<str:code>/", views.shortlink_open),
    path("status/", pg.my_status), path("status/feed/", pg.status_feed),
    path("linkpage/", pg.my_pages), path("linkpage/<int:pk>/", pg.my_page_detail), path("linkpage/<int:pk>/stats/", pg.card_stats), path("l/<str:handle>/", pg.public_page), path("check-name/", pg.check_name), path("l/<str:handle>/event/", pg.card_event), path("upgrade/", pg.upgrade),
    # staff only
    path("admin/overview/", adm.overview), path("admin/users/", adm.users), path("admin/users/<int:pk>/", adm.user_detail),
    path("admin/links/", adm.links), path("admin/links/<int:pk>/", adm.link_detail),
    path("locks/", views.locks), path("locks/verify/", views.lock_verify),
]
