# CoTURN TURN Server Docker Image
# Optimized for WebRTC relay-only connections

FROM ubuntu:22.04

# Install CoTURN and required packages
RUN apt-get update && \
    apt-get install -y \
    coturn \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create directory for CoTURN configuration
RUN mkdir -p /var/lib/coturn /var/log/coturn

# Copy configuration file
COPY turnserver.conf /etc/coturn/turnserver.conf

# Expose ports
# 3478: TURN server (UDP/TCP)
# 5349: TURN server over TLS (TCP)
# 49152-65535: Relay port range (UDP)
EXPOSE 3478/tcp 3478/udp
EXPOSE 5349/tcp
EXPOSE 49152-65535/udp

# Run as non-root user
RUN useradd -r -M -d /var/lib/coturn -s /bin/false turnserver && \
    chown -R turnserver:turnserver /var/lib/coturn /var/log/coturn

USER turnserver

# Start CoTURN
CMD ["turnserver", "-c", "/etc/coturn/turnserver.conf", "--log-file=stdout", "-v"]
