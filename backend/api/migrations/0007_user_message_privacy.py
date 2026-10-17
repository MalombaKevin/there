from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_user_last_seen'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='message_privacy',
            field=models.CharField(default='friends', max_length=10),
        ),
    ]
