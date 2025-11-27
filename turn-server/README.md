# CoTURN TURN Server - Self-Hosted Deployment

This directory contains a production-ready CoTURN TURN server setup for WebRTC relay-only connections. All traffic is routed through the TURN server, preventing IP address leakage.

## Overview

- **CoTURN**: Open-source TURN/STUN server
- **Relay-Only Mode**: Forces all connections through the relay server
- **Docker Deployment**: Easy deployment with Docker Compose
- **Unraid Compatible**: Tested on Unraid server platform
- **TLS Support**: Optional TURNS (TURN over TLS) for encrypted signaling

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Public server with open ports
- Static public IP address

### 1. Configure the Server

Edit `turnserver.conf` and update the following:

```conf
# Replace with your server's public IP
external-ip=YOUR_PUBLIC_IP

# Update the realm (domain)
realm=turn.yourdomain.com

# IMPORTANT: Change default credentials!
user=your_username:your_secure_password
```

### 2. Build and Run

```bash
cd turn-server
docker-compose up -d
```

### 3. Check Logs

```bash
docker-compose logs -f coturn
```

### 4. Test the Server

Use the TURN server tester:
```bash
docker exec coturn-turn-server turnutils_uclient -v 127.0.0.1 -u your_username -w your_secure_password
```

## Firewall Configuration

### Required Ports

Open the following ports on your firewall:

- **3478/TCP**: TURN server (TCP)
- **3478/UDP**: TURN server (UDP)
- **5349/TCP**: TURN server over TLS (TURNS)
- **49152-65535/UDP**: Media relay port range

### Example UFW Rules (Ubuntu)

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp
sudo ufw reload
```

### Example iptables Rules

```bash
iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
iptables -A INPUT -p udp --dport 3478 -j ACCEPT
iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

## Unraid Deployment

### Method 1: Docker Compose (Recommended)

1. **Install Docker Compose Plugin** (if not installed):
   - Go to Unraid **Apps** tab
   - Search for "Docker Compose Manager"
   - Install the plugin

2. **Copy Files to Unraid**:
   ```bash
   # Via SSH or WebUI
   mkdir -p /mnt/user/appdata/coturn
   cd /mnt/user/appdata/coturn
   # Copy Dockerfile, docker-compose.yml, turnserver.conf here
   ```

3. **Configure**:
   - Edit `turnserver.conf` with your public IP and credentials
   - Update `docker-compose.yml` if needed

4. **Deploy**:
   ```bash
   docker-compose up -d
   ```

### Method 2: Unraid Community Applications

1. **Add Custom Container**:
   - Go to **Docker** tab
   - Click **Add Container**

2. **Configure Container**:
   - **Name**: `coturn-turn-server`
   - **Repository**: `coturn/coturn:latest` (or build your own)
   - **Network Type**: `Host` (recommended for TURN)
   - **Console Shell Command**: `bash`

3. **Add Paths**:
   - **Config Path**: `/etc/coturn/turnserver.conf` → `/mnt/user/appdata/coturn/turnserver.conf`

4. **Add Ports** (if not using Host network):
   - Container: `3478` → Host: `3478` (TCP)
   - Container: `3478` → Host: `3478` (UDP)
   - Container: `5349` → Host: `5349` (TCP)
   - Container: `49152-65535` → Host: `49152-65535` (UDP)

5. **Environment Variables** (optional):
   - `REALM=turn.yourdomain.com`

### Method 3: Build Custom Image

```bash
# On Unraid server
cd /mnt/user/appdata/coturn
docker build -t local/coturn:latest .
docker run -d \
  --name coturn-turn-server \
  --network host \
  --restart unless-stopped \
  -v /mnt/user/appdata/coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro \
  local/coturn:latest
```

## TLS/TURNS Configuration

For encrypted TURN (TURNS), you need SSL/TLS certificates.

### Using Let's Encrypt

1. **Get Certificates**:
   ```bash
   certbot certonly --standalone -d turn.yourdomain.com
   ```

2. **Update turnserver.conf**:
   ```conf
   cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
   pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
   ```

3. **Mount Certificates in docker-compose.yml**:
   ```yaml
   volumes:
     - /etc/letsencrypt:/etc/letsencrypt:ro
   ```

4. **Restart Container**:
   ```bash
   docker-compose restart
   ```

## Security Best Practices

### 1. Change Default Credentials

**Never use default credentials in production!**

```conf
# Use strong, random passwords
user=secure_username:$(openssl rand -base64 32)
```

### 2. Restrict Access by IP (Optional)

```conf
# Allow only specific IP ranges
allowed-peer-ip=203.0.113.0-203.0.113.255
```

### 3. Enable Rate Limiting

```conf
# Limit connections per IP
max-allocate-lifetime=3600
max-bps=1000000  # 1 Mbps per session
```

### 4. Use TLS (TURNS)

Always use TURNS in production for encrypted signaling.

### 5. Monitor Logs

```bash
docker-compose logs -f --tail=100 coturn
```

## Application Configuration

Once your TURN server is running, configure SECURE.LINK to use it:

1. **Navigate to Create/Join Room**
2. **Click "Configure TURN Server"** (modal will appear on first use)
3. **Enter Server Details**:
   - **TURN Server URL**: `turn:your-server-ip:3478`
   - **Username**: `your_username`
   - **Credential**: `your_secure_password`
   - For TLS: `turns:your-server-ip:5349`

4. **Test Connection**:
   - Create a room
   - Join from another device
   - Verify connection works through relay

## Testing & Troubleshooting

### Test TURN Server

```bash
# Test from local machine
turnutils_uclient -v your-server-ip -u your_username -w your_password

# Test from Docker container
docker exec coturn-turn-server turnutils_uclient -v 127.0.0.1 -u your_username -w your_password
```

### Check Connection

```bash
# View active TURN sessions
docker exec coturn-turn-server turnutils_peer -v

# Monitor bandwidth
docker stats coturn-turn-server
```

### Common Issues

**Issue**: Clients can't connect
- **Check**: Firewall rules allow ports 3478 and 49152-65535
- **Check**: `external-ip` is set correctly in config
- **Check**: Credentials match between server and client

**Issue**: High latency
- **Check**: Server location relative to users
- **Check**: Bandwidth limits in config
- **Solution**: Deploy server closer to users

**Issue**: TLS certificate errors
- **Check**: Certificate paths are correct
- **Check**: Certificates are valid and not expired
- **Solution**: Renew certificates with certbot

## Performance Tuning

### For High Traffic

```conf
# Increase connection limits
max-allocate-lifetime=7200
user-quota=0
total-quota=0

# Adjust port range
min-port=40000
max-port=60000
```

### For Low Latency

```conf
# Reduce timeouts
stale-nonce=300
channel-lifetime=300
```

## Monitoring

### Prometheus Metrics

Add Prometheus exporter:
```yaml
# docker-compose.yml
services:
  coturn-exporter:
    image: mfuterko/coturn-exporter
    ports:
      - "9641:9641"
```

### Grafana Dashboard

Import CoTURN dashboard: https://grafana.com/grafana/dashboards/13493

## Cost Estimation

### Cloud Providers (Monthly)

- **DigitalOcean Droplet**: $6-12 (1-2GB RAM)
- **AWS EC2 t3.small**: ~$15
- **Linode Nanode**: $5
- **Vultr Cloud Compute**: $6

### Bandwidth

- **Light use** (10 users/day): ~50GB/month
- **Medium use** (100 users/day): ~500GB/month
- **Heavy use** (1000 users/day): ~5TB/month

## Backup & Recovery

### Backup Configuration

```bash
# Backup config
cp turnserver.conf turnserver.conf.backup

# Backup with timestamp
tar -czf coturn-backup-$(date +%Y%m%d).tar.gz turnserver.conf docker-compose.yml
```

### Restore

```bash
# Extract backup
tar -xzf coturn-backup-20231120.tar.gz

# Restart service
docker-compose restart
```

## Additional Resources

- **CoTURN Documentation**: https://github.com/coturn/coturn
- **WebRTC TURN Guide**: https://webrtc.org/getting-started/turn-server
- **Docker Hub**: https://hub.docker.com/r/coturn/coturn
- **Community**: https://github.com/coturn/coturn/discussions

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review CoTURN logs: `docker-compose logs -f`
3. Test with turnutils_uclient
4. Open an issue on GitHub

## License

CoTURN is licensed under the BSD License.
This configuration is provided as-is for use with SECURE.LINK.
