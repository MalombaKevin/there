FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libjpeg62-turbo zlib1g && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/media && DJANGO_SECRET_KEY=build-only-key python manage.py collectstatic --noinput
EXPOSE 8000
# migrate on start, then serve with gunicorn
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn opio.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --timeout 60"]
