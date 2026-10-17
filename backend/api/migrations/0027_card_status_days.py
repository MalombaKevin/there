from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0026_card_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='linkpage',
            name='status_days',
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='linkpage',
            name='status_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
