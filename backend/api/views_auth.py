import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .helpers import user_min

User = get_user_model()
USERNAME_RX = re.compile(r"^[a-z0-9_]{3,20}$")


def tokens_for(user):
    r = RefreshToken.for_user(user)
    return {"access": str(r.access_token), "refresh": str(r)}


def session_payload(user):
    return {**tokens_for(user), "user": me_dict(user)}


def me_dict(u):
    return {**user_min(u), "online": False, "email": u.email, "is_staff": u.is_staff, "is_pro": u.is_pro, "is_private": u.is_private, "interests": u.interests,
            "interests_set": u.interests_set, "blocked_categories": u.blocked_categories,
            "hide_adult": u.hide_adult, "nicknames": u.nicknames, "message_privacy": u.message_privacy,
            "qr_messages": u.qr_messages, "qr_private": u.qr_private, "invite_role": u.invite_role, "invite_analytics": u.invite_analytics, "invite_perms": u.invite_perms or {},
            "gender": u.gender, "country": u.country, "show_gender": u.show_gender, "show_country": u.show_country,
            "blocked_countries": u.blocked_countries, "blocked_keywords": u.blocked_keywords, "auto_delete_days": u.auto_delete_days,
            "auto_delete": {k: (u.auto_delete or {}).get(k, u.auto_delete_days) for k in ("link", "qr", "board")}}


def big_google_photo(url):
    """Google sends a 96px thumbnail; ask for a larger square crop so it stays sharp everywhere."""
    url = url or ""
    return re.sub(r"=s\d+(-c)?$", "=s512-c", url) if "googleusercontent.com/" in url else url


def unique_username(base):
    base = re.sub(r"[^a-z0-9_]", "", (base or "user").lower())[:14] or "user"
    if len(base) < 3:
        base += "user"
    name, i = base, 1
    while User.objects.filter(username=name).exists():
        i += 1
        name = f"{base}{i}"
    return name


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """Create a profile with email + password."""
    d = request.data
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    name = (d.get("name") or "").strip()[:60]
    username = (d.get("username") or "").strip().lower().lstrip("@")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return Response({"detail": "Enter a valid email."}, status=400)
    if not USERNAME_RX.match(username):
        return Response({"detail": "Username: 3-20 letters, numbers or _."}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({"detail": "That email already has an account. Log in instead."}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "That username is taken."}, status=400)
    try:
        validate_password(password)
    except ValidationError as e:
        return Response({"detail": " ".join(e.messages)}, status=400)
    user = User.objects.create_user(username=username, email=email, password=password, name=name)
    return Response(session_payload(user), status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    """Log in with email (or username) + password."""
    ident = (request.data.get("email") or request.data.get("username") or "").strip().lower()
    password = request.data.get("password") or ""
    user = User.objects.filter(email__iexact=ident).first() or User.objects.filter(username=ident.lstrip("@")).first()
    if not user or not user.has_usable_password() or not user.check_password(password):
        return Response({"detail": "Wrong email or password."}, status=400)
    return Response(session_payload(user))


@api_view(["POST"])
@permission_classes([AllowAny])
def google_login(request):
    """Sign in with Google. The frontend sends the Google ID token (credential)."""
    cred = request.data.get("credential")
    if not settings.GOOGLE_CLIENT_ID:
        return Response({"detail": "Google sign-in is not configured (set GOOGLE_CLIENT_ID)."}, status=503)
    try:
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token
        info = id_token.verify_oauth2_token(cred, g_requests.Request(), settings.GOOGLE_CLIENT_ID)
    except Exception:
        return Response({"detail": "Google sign-in failed."}, status=400)
    if not info.get("email_verified", False):
        return Response({"detail": "Your Google email is not verified."}, status=400)
    email = info["email"].lower()
    user = User.objects.filter(email__iexact=email).first()
    created = False
    if not user:
        user = User(username=unique_username(email.split("@")[0]), email=email,
                    name=(info.get("name") or email.split("@")[0])[:60], photo=big_google_photo(info.get("picture", "")))
        user.set_unusable_password()
        user.save()
        created = True
    return Response({**session_payload(user), "created": created}, status=201 if created else 200)
