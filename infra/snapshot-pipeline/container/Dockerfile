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

# Bundle the repo's build-snapshot.py + sibling modules it imports at runtime.
# Update THIS list when build-snapshot.py grows new sibling imports.
# Runtime sibling imports currently required (as of v0.2.2):
#   - build_projections            (imported by build-snapshot.py at line ~2215)
#   - build_projections_report     (imports build_projections; kept alongside for parity)
# If build-snapshot.py adds `import build_XXX` or `from build_XXX import ...`
# where build_XXX is a local sibling module, add a matching COPY line below
# or the container will crash at runtime with ImportError.
WORKDIR /opt/repo
COPY --chown=pipeline:pipeline scripts/build-snapshot.py           /opt/repo/scripts/build-snapshot.py
COPY --chown=pipeline:pipeline scripts/build_projections.py        /opt/repo/scripts/build_projections.py
COPY --chown=pipeline:pipeline scripts/build_projections_report.py /opt/repo/scripts/build_projections_report.py

# LLM prompts loaded from disk at runtime (resolved relative to REPO_ROOT).
# build-snapshot.py :: _load_risk_factor_prompt() reads
# data/prompts/risk-factor-analysis.system.md. Bundle the whole prompts/
# dir so new prompt files land in the image without another Dockerfile edit.
COPY --chown=pipeline:pipeline data/prompts/                       /opt/repo/data/prompts/

# App source
WORKDIR /app
COPY --chown=pipeline:pipeline container/app.py /app/app.py

USER pipeline

# APP_VERSION is a build-arg so /healthz reflects the actual image tag.
# Pass at build time: az acr build --build-arg APP_VERSION=v0.2.2 ...
ARG APP_VERSION=dev
ENV REPO_ROOT=/opt/repo \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_VERSION=$APP_VERSION

EXPOSE 8080

# uvicorn with a single worker — Container App handles horizontal scaling.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
