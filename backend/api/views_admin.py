"""Staff-only admin API: site totals, people and public links. Anyone without is_staff gets 403."""
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import Board, Link, Message

User = get_user_model()
LIMIT = 100


def user_row(u):
    return {"id": u.id, "username": u.username, "name": u.display(), "email": u.email or "", "photo": u.photo,
            "is_active": u.is_active, "is_staff": u.is_staff, "joined": u.date_joined.isoformat(),
            "last_seen": u.last_seen.isoformat() if u.last_seen else None, "links": u.n_links, "boards": u.n_boards}


def link_row(l):
    return {"id": l.id, "title": l.title, "host": l.host, "url": l.url, "category": l.category, "is_public": l.is_public,
            "advertised": l.advertised, "adult": l.adult, "owner": l.owner.username, "created": l.created.isoformat()}


@api_view(["GET"])
@permission_classes([IsAdminUser])
def overview(request):
    week = timezone.now() - timedelta(days=7)
    return Response({
        "users": User.objects.count(), "users_7d": User.objects.filter(date_joined__gte=week).count(),
        "active_7d": User.objects.filter(last_seen__gte=week).count(), "disabled": User.objects.filter(is_active=False).count(),
        "links": Link.objects.count(), "links_7d": Link.objects.filter(created__gte=week).count(),
        "public_links": Link.objects.filter(is_public=True).count(), "advertised": Link.objects.filter(advertised=True).count(),
        "boards": Board.objects.count(), "public_boards": Board.objects.filter(is_public=True).count(),
        "messages": Message.objects.count(), "messages_7d": Message.objects.filter(created__gte=week).count(),
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def users(request):
    q = (request.query_params.get("q") or "").strip().lstrip("@")
    qs = User.objects.annotate(n_links=Count("links", distinct=True), n_boards=Count("owned_boards", distinct=True))
    if q:
        qs = qs.filter(Q(username__icontains=q) | Q(name__icontains=q) | Q(email__icontains=q))
    return Response([user_row(u) for u in qs.order_by("-date_joined")[:LIMIT]])


@api_view(["PATCH"])
@permission_classes([IsAdminUser])
def user_detail(request, pk):
    """Disable or re-enable an account. You cannot disable yourself or another staff member."""
    u = User.objects.filter(pk=pk).first()
    if not u:
        return Response({"detail": "User not found"}, status=404)
    if u.id == request.user.id or u.is_staff:
        return Response({"detail": "You can't change a staff account here."}, status=400)
    if "is_active" in request.data:
        u.is_active = bool(request.data["is_active"])
        u.save(update_fields=["is_active"])
    u = User.objects.annotate(n_links=Count("links", distinct=True), n_boards=Count("owned_boards", distinct=True)).get(pk=pk)
    return Response(user_row(u))


@api_view(["GET"])
@permission_classes([IsAdminUser])
def links(request):
    q = (request.query_params.get("q") or "").strip()
    qs = Link.objects.filter(is_public=True).select_related("owner")
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(host__icontains=q) | Q(owner__username__icontains=q))
    return Response([link_row(l) for l in qs[:LIMIT]])


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def link_detail(request, pk):
    deleted, _ = Link.objects.filter(pk=pk).delete()
    return Response(status=204 if deleted else 404)
