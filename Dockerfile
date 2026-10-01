# =====================================================================
# LuminIRIS - Container Image
# Base image (official, public, no login required), pinned to the 2026.2
# GA tag (also tagged latest-cd in the InterSystems Container Registry):
#   Docker Hub : intersystemsdc/iris-community:2026.2
#   ICR        : containers.intersystems.com/intersystems/iris-community:2026.2
# Requires IRIS 2026.2+ (official SysAdmin API /api/admin)
# =====================================================================
FROM intersystemsdc/iris-community:2026.2

ARG ISC_PACKAGE_MGRUSER=irisowner
ARG ISC_PACKAGE_IRISGROUP=irisgroup

# Copy the IPM module into the image
COPY --chown=$ISC_PACKAGE_MGRUSER:$ISC_PACKAGE_IRISGROUP . /irisdev/app/

# Build-time provisioning:
#   start IRIS -> install module with IPM -> permit anonymous static
#   access -> stop IRIS. At container runtime the image default
#   ENTRYPOINT (iris-main) starts IRIS automatically.
RUN iris start IRIS \
 && iris session IRIS -U USER < /irisdev/app/setup.script \
 && iris stop IRIS quietly

# 52773: Web Gateway (Management Portal + /api/admin + LuminIRIS)
# 1972 : SuperServer (default port inside the community container)
EXPOSE 52773 1972

# IRIS 2026.2+: skip the ISC Agent. On hosts where it cannot start, the
# post-startup "iris-after-start" hook exits 256 and the container ends
# with "[FATAL] Error executing post-startup command" (GitHub issue #2).
# docker-compose passes the same flag via its command: override.
CMD ["/iris-main", "--ISCAgent", "false"]
