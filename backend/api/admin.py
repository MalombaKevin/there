from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from . import models

admin.site.register(models.User, UserAdmin)
for m in (models.Link, models.Board, models.BoardLink, models.BoardInvite, models.Follow, models.Friendship,
          models.Message, models.Block):
    admin.site.register(m)
