# FHA snapshot pipeline container.
#
# Bundles scripts/build-snapshot.py from the repo so we run a pinned copy —
# updates to the script require a new image + Container App revision.
#
# Non-root user, distroless-adjacent (slim base, no build tools in the final
# image).

FROM python:3.11-slim AS build

WORKDIR /build

# Install build tools only in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir --prefix=/install -r requirements.txt


FROM python:3.11-slim AS runtime

# Runtime OS deps: none extra beyond what -slim provides.

# Non-root user
RUN groupadd --system --gid 1001 pipeline \
    && useradd  --system --uid 1001 --gid pipeline --home-dir /home/pipeline --shell /usr/sbin/nologin pipeline \
    && mkdir -p /home/pipeline \
    && chown -R pipeline:pipeline /home/pipeline

# Bring installed Python deps from the build stage.
COPY --from=build /install /usr/local

# Bundle the repo's build-snapshot.py at a known path (REPO_ROOT env var).
# Only the pieces build-snapshot.py needs — no need to copy the whole repo.
WORKDIR /opt/repo
COPY --chown=pipeline:pipeline scripts/build-snapshot.py /opt/repo/scripts/build-snapshot.py

# App source
WORKDIR /app
COPY --chown=pipeline:pipeline container/app.py /app/app.py

USER pipeline

ENV REPO_ROOT=/opt/repo \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_VERSION=0.1.0

EXPOSE 8080

# uvicorn with a single worker — Container App handles horizontal scaling.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
