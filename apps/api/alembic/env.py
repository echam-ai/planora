from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from planora_api.config import load_settings
from planora_api.db.migration_compat import historical_postgresql_checks
from planora_api.db.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
#
# `disable_existing_loggers=False` (fileConfig's default is True) is
# required here: this module runs inside the same process as the API
# whenever a migration is applied programmatically (the test suite's
# `migrated_db_path`/`seeded_user` fixtures, and any future in-process
# migration runner). `fileConfig`'s default would otherwise permanently
# disable every logger already created at that point that alembic.ini
# doesn't itself declare — including every `planora_api.*` logger (issue
# #27's structured logging) — for the rest of the process, silently
# dropping all of its log output with no error.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Autogenerate support: compare the models against this metadata.
target_metadata = Base.metadata

# The database URL comes from `Settings.database_url` (planora_api/config.py,
# fixed by #21) — never from `sqlalchemy.url` in alembic.ini. This is the
# only place besides `db/session.py` that names the database.
# ConfigParser treats '%' as interpolation syntax; URL-encoded credentials
# contain literal percent signs. Escape for storage; reads recover the URL.
config.set_main_option("sqlalchemy.url", load_settings().database_url.replace("%", "%%"))


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


with historical_postgresql_checks():
    if context.is_offline_mode():
        run_migrations_offline()
    else:
        run_migrations_online()
