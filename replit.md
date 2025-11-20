# Overview

SECURE.LINK is an end-to-end encrypted peer-to-peer communication application that enables secure, temporary connections between two users without server-side data storage. The system facilitates real-time text messaging, voice chat, and file transfers through WebRTC technology, with optional password protection and automatic room expiration.

## Recent Updates (November 20, 2025)

- **Peer Nicknames**: Users enter nicknames before joining/creating rooms, displayed in chat and room header
- **Dynamic Password Setting**: Room creators can add/update passwords without leaving the room via "SET PASSWORD" button
- **Creator Privileges with Persistence**: Room creators bypass password authentication and maintain creator status across page refreshes via localStorage (persists for 24-hour room lifetime on same device/browser)
- **TURN Server Integration**: Added relay servers on port 443 (HTTPS) to ensure connections work through restrictive firewalls
- **Admin Panel**: Secure admin dashboard with 2FA support for monitoring peer connections
- **Password Protection on Shared Links**: Direct room links now require password verification before allowing access
- **Peer Tracking**: Real-time device information (IP, OS, browser, device type) tracking for admin monitoring

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
- **Not Found**: 404 error page

### Communication Features
- Chat interface with message history
- File transfer with drag-and-drop support
- QR code scanning for room joining (simulated)
- Voice chat toggle functionality

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