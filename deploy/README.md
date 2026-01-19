# SECURE.LINK VM Deployment

## Quick Install (Ubuntu 24.04 LTS)

### Prerequisites
- Ubuntu 24.04 LTS server
- Node.js 20+ installed
- PostgreSQL database
- Git installed

### Installation

```bash
# Clone and install
sudo git clone https://github.com/m975261/securep2pconnect.git /opt/securelink
cd /opt/securelink/deploy
sudo chmod +x install.sh update.sh
sudo ./install.sh

# Configure (edit database credentials)
sudo nano /opt/securelink/.env.production

# Start service
sudo systemctl start secure-webrtc-app
```

### Updating

```bash
cd /opt/securelink/deploy
sudo ./update.sh
```

### Configuration

Edit `/opt/securelink/.env.production`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TURN_ENCRYPTION_KEY` | Auto-generated, do not change after initial setup |
| `PORT` | Server port (default: 5000) |

### Service Management

```bash
# Start/Stop/Restart
sudo systemctl start secure-webrtc-app
sudo systemctl stop secure-webrtc-app
sudo systemctl restart secure-webrtc-app

# View logs
sudo journalctl -u secure-webrtc-app -f

# Check status
sudo systemctl status secure-webrtc-app
```

### Troubleshooting

**TURN mode badge not showing:**
1. TURN credentials must be re-entered after installation
2. The TURN_ENCRYPTION_KEY must remain constant
3. Check browser console for `[Connection] connected` log

**Database connection errors:**
1. Verify DATABASE_URL in .env.production
2. Ensure PostgreSQL is running: `sudo systemctl status postgresql`
3. Check database exists and user has access

### Architecture Notes

- Frontend: React + Vite (built to dist/public)
- Backend: Express.js + WebSocket (dist/index.js)
- Database: PostgreSQL with Drizzle ORM
- TURN credentials are encrypted at rest using TURN_ENCRYPTION_KEY
