from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="Announcement",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=120, verbose_name="标题")),
                ("body", models.TextField(verbose_name="正文")),
                ("level", models.CharField(choices=[("info", "普通"), ("warning", "重要")], default="info", max_length=7, verbose_name="级别")),
                ("url", models.URLField(blank=True, validators=[django.core.validators.URLValidator(schemes=["https"])], verbose_name="详情链接")),
                ("expires_at", models.DateTimeField(blank=True, null=True, verbose_name="到期时间")),
            ],
        ),
        migrations.CreateModel(
            name="Operation",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("actor", models.CharField(max_length=150)),
                ("resource", models.CharField(max_length=120)),
                ("value", models.CharField(max_length=120)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
    ]
