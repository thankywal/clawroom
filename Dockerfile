# The image every member's computer starts from. Pinned to the SDK version,
# because the two are released together and drift between them is the first
# thing the docs warn about.
FROM docker.io/cloudflare/sandbox:0.12.9

# The base image ships Node, Bun, git, curl and jq. It does not ship Python,
# and an agent asked to analyse anything reaches for Python first.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && ln -s /usr/bin/python3 /usr/bin/python \
 && rm -rf /var/lib/apt/lists/*
