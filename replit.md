# Overview

SECURE.LINK is an end-to-end encrypted peer-to-peer communication application that enables secure, temporary connections between two users without server-side data storage. The system facilitates real-time text messaging, voice chat, and file transfers through WebRTC technology, with optional password protection and automatic room expiration.

## Recent Updates

### November 27, 2025 - P2P System Complete
- **Complete P2P Mode**: Native helper application for true peer-to-peer with IP hiding
- **Audio + Video Support**: Full duplex media streaming through libp2p overlay network
- **Go Helper**: Pion WebRTC bridge between browser and libp2p (main-refactored.go)
- **RTP Packet Framing**: Length-prefixed framing for reliable stream delivery
- **Stream Reconnection**: Automatic recovery on connection failures
- **Build Requirement**: Go 1.21+ required for compilation (documented in README)
- **Cross-Platform**: Build scripts for Windows, macOS (Intel/ARM), Linux

### November 20, 2025 - Traditional Mode
- **Peer Nicknames**: Users enter nicknames before joining/creating rooms
- **Dynamic Password Setting**: Room creators can update passwords in real-time
- **Creator Privileges**: Bypass authentication with localStorage persistence
- **TURN Server Integration**: Port 443 relay servers for firewall traversal
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
- **Create Room**: Form to initialize new secure rooms with optional password
- **Join Room**: Interface to connect to existing rooms via room ID
- **Room**: Main communication interface with chat, file transfer, and voice capabilities
- **P2P Room** (`/p2p`): Privacy-enhanced mode using native helper application
- **Not Found**: 404 error page

### Communication Features

**Traditional Mode (TURN-based):**
- Chat interface with message history
- File transfer with drag-and-drop support
- QR code scanning for room joining
- Voice chat toggle functionality
- TURN relay servers for firewall traversal

**P2P Mode (Helper-based):**
- Complete IP hiding (PeerID only)
- Audio and video support
- No STUN/TURN servers needed
- Encrypted libp2p streams
- Requires native helper application

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
- Room creator bypass: Creators skip password authentication (validated server-side)
- Dynamic password setting: Creators can add/update passwords via secure API endpoint
- Creator identity persistence: peerId stored in localStorage to maintain creator status across page refreshes (same device/browser only)
- Failed attempt tracking with progressive penalties
- IP-based banning after multiple failed attempts (configurable hours)
- Automatic room expiration (24-hour default TTL)

**Rate Limiting**
- Tracks failed password attempts per IP per room
- Incremental lockout periods for repeated failures
- Automatic cleanup of expired ban records

### WebRTC Signaling Flow
1. Client connects to WebSocket server
2. Client sends join message with room ID
3. Server validates room existence and password (if required)
4. Server facilitates ICE candidate and SDP offer/answer exchange
5. Peers establish direct P2P connection
6. Server notifies peers of connection/disconnection events

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
- STUN/TURN server configuration not explicitly defined (uses browser defaults)
- Data channels for text messaging and file transfer
- Media streams for voice chat functionality

### Session Management
- **connect-pg-simple**: PostgreSQL session store (imported but not actively used in current implementation)
- WebSocket-based connection tracking instead of traditional sessions

### Icons and Assets
- **lucide-react**: Icon component library
- Custom fonts: Inter, JetBrains Mono, Space Grotesk (loaded from Google Fonts)
- Custom background images stored in attached_assets directory