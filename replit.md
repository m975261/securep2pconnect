# Overview

SECURE.LINK is a WebRTC communication application that enables secure, temporary connections between two users through TURN relay servers (relay-only mode to prevent IP leakage). The system facilitates real-time text messaging, voice chat, and file transfers through WebRTC technology, with optional password protection and automatic room expiration. Users provide their own TURN server configuration for complete privacy control.

## Recent Updates

### December 3, 2025 - Server-Side Encrypted TURN Configuration
- **Encrypted TURN Storage**: TURN credentials encrypted server-side using AES-256-GCM before database storage
- **Room-Bound TURN Config**: TURN server config stored with each room, not globally in localStorage
- **Simplified Join Flow**: Joiners automatically receive TURN config from server (no manual configuration needed)
- **Auto-Proceed Flow**: After configuring TURN, users automatically proceed to room creation
- **API Security**: New `/api/rooms/:id/turn-config` endpoint for secure credential retrieval
- **Encryption Module**: `server/encryption.ts` handles encrypt/decrypt with derived key from environment

### November 27, 2025 - TURN-Relay-Only Architecture
- **P2P Infrastructure Removed**: Deleted all P2P helper code (helper/, webrtc-p2p.ts, p2p-room.tsx)
- **User-Provided TURN Servers**: TurnConfigModal component for users to input their own TURN server credentials
- **Relay-Only Mode**: WebRTC forced to `iceTransportPolicy: 'relay'` - no direct P2P connections, no IP leakage
- **No Default TURN Servers**: Users must configure their own TURN server before creating/joining rooms
- **CoTURN Docker Setup**: Production-ready self-hosted TURN server with Docker Compose and Unraid deployment guide
- **Database Schema Update**: Removed `creatorPeerId` field (no longer needed without P2P mode)
- **Bilingual Support**: English/Arabic with RTL layout support in all UI components

### November 20, 2025 - Traditional Mode (Deprecated - Replaced by TURN-Only)
- **Peer Nicknames**: Users enter nicknames before joining/creating rooms
- **Dynamic Password Setting**: Room creators can update passwords in real-time
- **Admin Panel**: Secure dashboard with 2FA for monitoring
- **Password Protection on Links**: Direct room links require password verification
- **Peer Tracking**: Real-time device information tracking

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

### Technology Stack
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **Styling**: Tailwind CSS with custom design system (New York variant from shadcn/ui)
- **State Management**: React hooks and TanStack Query for server state
- **UI Components**: Radix UI primitives with custom styling via shadcn/ui
- **Build Tool**: Vite for fast development and optimized production builds

### Key Design Decisions
- Component-based architecture with reusable UI primitives from Radix UI
- Custom design system with dark theme as default (hsl-based color palette)
- Client-side form validation using React Hook Form with Zod schemas
- Real-time communication handled through custom WebRTC hooks
- Mobile-responsive design with breakpoint utilities

### Page Structure
- **Home**: Landing page with navigation to create/join rooms
- **Create Room**: Form to initialize new secure rooms with optional password, requires TURN configuration
- **Join Room**: Interface to connect to existing rooms via room ID, requires TURN configuration
- **Room**: Main communication interface with chat, file transfer, and voice capabilities
- **Admin Login**: Secure admin authentication with 2FA support
- **Admin Dashboard**: Room monitoring and analytics
- **Not Found**: 404 error page

### Communication Features

**TURN-Relay-Only Mode:**
- Chat interface with message history
- File transfer with drag-and-drop support (via WebSocket signaling)
- QR code generation and scanning for room joining
- Voice chat toggle functionality (audio only)
- **User-configured TURN servers**: Users provide their own TURN server URLs, username, and credentials
- **No IP leakage**: All WebRTC traffic forced through TURN relay (iceTransportPolicy: 'relay')
- **TurnConfigModal**: Bilingual modal for TURN server configuration, stored in localStorage
- **Self-hosted option**: Complete CoTURN Docker setup included in `turn-server/` directory

## Backend Architecture

### Technology Stack
- **Runtime**: Node.js with Express.js
- **WebSocket**: ws library for real-time bidirectional communication
- **Database ORM**: Drizzle ORM
- **Database**: PostgreSQL (Neon serverless)
- **Build**: esbuild for production bundling
- **Development**: tsx for TypeScript execution

### Core Components

**HTTP Server**
- Express middleware for JSON parsing and request logging
- RESTful API endpoints for room management
- Development mode integrates Vite middleware for HMR
- Production mode serves static assets from dist/public

**WebSocket Server**
- Dedicated WebSocket server mounted on `/ws` path
- Manages peer-to-peer signaling for WebRTC connections
- Tracks active peers and room associations
- Handles offer/answer/ICE candidate exchange

**Storage Layer**
- Abstracted storage interface (IStorage) for database operations
- PostgreSQL implementation using Drizzle ORM
- Room lifecycle management with automatic expiration
- Failed login attempt tracking with IP-based rate limiting

### Security Features

**Room Protection**
- Optional password protection for rooms
- Failed attempt tracking with progressive penalties
- IP-based banning after multiple failed attempts (configurable hours)
- Automatic room expiration (24-hour default TTL)

**IP Privacy**
- **Relay-only WebRTC**: `iceTransportPolicy: 'relay'` enforced on all peer connections
- **No STUN servers**: Application does not use any STUN servers to prevent local IP discovery
- **User-controlled TURN servers**: Users provide their own TURN relay servers for complete control
- **No default relays**: Application ships with no built-in TURN server credentials

**TURN Credential Encryption**
- **AES-256-GCM encryption**: TURN username and credentials encrypted at rest in database
- **Per-room storage**: Each room stores its own encrypted TURN configuration
- **Secure retrieval**: Credentials decrypted only when returned via API for authorized requests
- **Key derivation**: Encryption key derived from environment variable using SHA-256

**Rate Limiting**
- Tracks failed password attempts per IP per room
- Incremental lockout periods for repeated failures
- Automatic cleanup of expired ban records

### WebRTC Signaling Flow
1. User configures TURN server via TurnConfigModal (stored in localStorage)
2. Client connects to WebSocket server
3. Client sends join message with room ID
4. Server validates room existence and password (if required)
5. Server facilitates ICE candidate and SDP offer/answer exchange
6. WebRTC establishes TURN relay connection (forced via iceTransportPolicy: 'relay')
7. All media/data flows through user-provided TURN server (no direct P2P)
8. Server notifies peers of connection/disconnection events

## Database Schema

### Tables

**rooms**
- `id`: Unique room identifier (varchar, primary key)
- `password`: Optional bcrypt-hashed password (text, nullable)
- `createdBy`: Creator's peer identifier for authorization (text, nullable)
- `createdAt`: Room creation timestamp
- `expiresAt`: Automatic expiration timestamp (24 hours default)
- `peer1`: First connected peer identifier (text, nullable)
- `peer2`: Second connected peer identifier (text, nullable)
- `isActive`: Room availability status (boolean, default true)
- **Note**: `creatorPeerId` field was removed (no longer needed in TURN-only mode)

**peer_connections**
- `id`: UUID identifier (generated)
- `roomId`: Associated room reference
- `peerId`: Peer identifier
- `nickname`: Display name for the peer (text, nullable)
- `ipAddress`: Client IP address
- `userAgent`: Browser user agent string
- `connectedAt`: Connection timestamp

**failedAttempts**
- `id`: UUID identifier (generated)
- `roomId`: Associated room reference
- `ipAddress`: Client IP address
- `attempts`: Failed login counter
- `lastAttempt`: Timestamp of most recent failure
- `bannedUntil`: Temporary ban expiration (nullable)

### Design Rationale
- Minimal persistent state (only room metadata, not messages)
- Automatic cleanup through expiration timestamps
- IP-based security without requiring user accounts
- Two-peer limit enforced at schema level

## External Dependencies

### Database
- **Neon Serverless PostgreSQL**: Cloud-hosted database accessed via HTTP
- Connection string via `DATABASE_URL` environment variable
- Drizzle ORM for type-safe queries and migrations

### Frontend Libraries
- **@tanstack/react-query**: Async state management and caching
- **react-hook-form**: Form state and validation
- **zod**: Runtime type validation and schema definition
- **wouter**: Lightweight routing (SPA navigation)
- **framer-motion**: Animation library (noted as removed but still imported in components)
- **sonner**: Toast notification system
- **react-qr-code**: QR code generation for room sharing
- **jsQR**: QR code scanning from images
- **react-dropzone**: File upload with drag-and-drop

### Build and Development Tools
- **Vite**: Build tool with HMR and optimized bundling
- **@replit/vite-plugin-***: Replit-specific plugins for development environment
- **Tailwind CSS**: Utility-first CSS framework
- **TypeScript**: Static type checking across codebase

### WebRTC
- Native browser WebRTC APIs (no external library)
- **TURN-relay-only mode**: `iceTransportPolicy: 'relay'` enforced
- **User-provided TURN servers**: No default STUN/TURN servers in codebase
- Data channels for text messaging (via WebSocket signaling, not RTCDataChannel)
- Media streams for voice chat functionality (audio tracks through RTCPeerConnection)

### TURN Server (Self-Hosted)
- **CoTURN**: Open-source TURN/STUN server in Docker container
- **Location**: `turn-server/` directory with Dockerfile, docker-compose.yml, turnserver.conf
- **Security**: Blocks all private IP ranges (RFC 1918), runs as non-root user
- **Ports**: 3478 (TURN TCP/UDP), 5349 (TURNS/TLS), 49152-65535 (relay port range)
- **Deployment**: Optimized for Unraid with detailed README and configuration examples

### Session Management
- **connect-pg-simple**: PostgreSQL session store (imported but not actively used in current implementation)
- WebSocket-based connection tracking instead of traditional sessions

### Icons and Assets
- **lucide-react**: Icon component library
- Custom fonts: Inter, JetBrains Mono, Space Grotesk (loaded from Google Fonts)
- Custom background images stored in attached_assets directory