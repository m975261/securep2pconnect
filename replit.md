# Overview

SECURE.LINK is a WebRTC communication application designed for secure, temporary, peer-to-peer (P2P-first) connections.

## Recent Changes (January 2026)
- **FallbackController Architecture Refactor:**
  - Replaced scattered mode detection logic (~500 lines) with single `FallbackController` class
  - Clean state machine: pending → (p2p | turn) with permanent mode locking
  - One-way upgrade path: P2P → TURN allowed (for connectivity), TURN → P2P blocked
  - Mode detection: Single attempt from WebRTC stats after ICE connected (max 3 retries at 500ms)
  - Only initiator (joiner) triggers TURN fallback after 5-second P2P timeout
  - Controller methods: `init()`, `setInitiator()`, `startP2PTimeout()`, `cancelTimeout()`, `onConnected()`, `onFailed()`, `handlePeerMode()`, `reset()`, `lockToTurn()`, `upgradeToTurn()`
- Session storage persistence per room (survives page refresh)
- TURN/STUN hostname-only input normalization (auto-constructs full URLs)
- Removed debug panel from room page

## Changes (December 2025)
- Added dual database driver support (Neon cloud + local PostgreSQL) for deployment flexibility
- Created Ubuntu 24.04 LTS deployment package (`securelink-deploy.zip`)

It supports real-time text messaging, voice chat with AI-powered noise cancellation, and file transfers between two users. Key features include optional password protection, automatic room expiration, and a strict two-user room capacity. The system prioritizes P2P connections with automatic fallback to user-provided TURN servers for relay.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The frontend is built with React 18 and TypeScript, utilizing Wouter for routing and Tailwind CSS with a custom shadcn/ui-based design system for styling. State management is handled by React hooks and TanStack Query. The UI comprises reusable Radix UI primitives, forms are validated with React Hook Form and Zod, and real-time communication is managed via custom WebRTC hooks. It features a mobile-responsive design and includes pages for home, room creation, room joining, the main communication room, and a 404 page.

**Communication Features:**
- **P2P-First with TURN Fallback:** Attempts direct P2P connection first (`iceTransportPolicy: 'all'`) with an automatic 5-second timeout triggering an ICE restart for TURN relay fallback.
- **Connection Mode Indicator:** A visual badge displays the current connection mode (P2P, TURN, Pending, or Reconnecting).
- **User-Configured TURN Servers:** Users provide their own TURN server details via a bilingual `TurnConfigModal`.
- **AI Noise Cancellation:** Integrates `@sapphi-red/web-noise-suppressor` (RNNoise WASM) via an AudioWorklet pipeline for real-time microphone noise reduction.
- Text chat with history, drag-and-drop file transfer, QR code sharing/scanning for rooms, and voice chat.

**Connection Mode Detection (FallbackController):**
- **Detection Method:** Uses `RTCPeerConnection.getStats()` to find the selected ICE candidate pair and determine connection type based on candidate types (host/srflx = P2P, relay = TURN).
- **Detection Strategy:** Single detection attempt after ICE connected, with max 3 retries (500ms each) if stats not yet available. No continuous polling.
- **State Machine:** `pending` → `p2p` or `turn` (locked). Mode is frozen once determined except for P2P → TURN upgrade.
- **Fallback Logic:** Only the initiator (joiner) triggers TURN fallback after 5-second timeout. Non-initiator waits for new offer.
- **Mode Synchronization:** Detected modes broadcast via WebSocket. TURN takes priority (peer TURN → local upgrades). P2P accepted only if pending/reconnecting.
- **Persistence:** Mode persisted to sessionStorage per room, restored on page refresh.

## Backend Architecture

The backend uses Node.js with Express.js and a `ws` WebSocket library for real-time communication. Data persistence is managed with Drizzle ORM and a PostgreSQL database (Neon serverless). The HTTP server handles RESTful API endpoints for room management, while a dedicated WebSocket server (`/ws`) manages WebRTC signaling, including peer tracking and ICE candidate/SDP exchange.

**Security Features:**
- **Room Protection:** Optional password protection, IP-based rate limiting for failed attempts, and automatic room expiration (24-hour TTL).
- **Connection Strategy:** P2P-first WebRTC with automatic TURN fallback. Users provide their own TURN servers, and the application does not ship with default relays.
- **TURN Credential Encryption:** TURN username and credentials are encrypted at rest using AES-256-GCM, stored per-room, and decrypted only for authorized requests using a key derived from an environment variable.
- **Rate Limiting:** Tracks failed password attempts per IP per room with incremental lockout periods.

## Database Schema

The database includes tables for `rooms`, `peer_connections`, and `failedAttempts`.
- `rooms`: Stores room ID, optional hashed password, creation/expiration timestamps, peer identifiers, and active status.
- `peer_connections`: Tracks connected peers' UUIDs, room IDs, nicknames, IP addresses, user agents, and connection timestamps.
- `failedAttempts`: Records failed login attempts per room and IP, including attempt count and ban expiration.

The schema is designed for minimal persistent state, automatic cleanup via expiration, and IP-based security without user accounts.

# External Dependencies

## Database
- **Neon Serverless PostgreSQL**: Cloud-hosted database.
- **Drizzle ORM**: For type-safe queries and migrations.

## Frontend Libraries
- **@tanstack/react-query**: Async state management.
- **react-hook-form**: Form state and validation.
- **zod**: Runtime type validation.
- **wouter**: Lightweight routing.
- **sonner**: Toast notifications.
- **react-qr-code**: QR code generation.
- **jsQR**: QR code scanning.
- **react-dropzone**: Drag-and-drop file upload.
- **@sapphi-red/web-noise-suppressor**: RNNoise WASM for AI noise cancellation.

## Build and Development Tools
- **Vite**: Build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **TypeScript**: Static type checking.

## WebRTC
- Native browser WebRTC APIs.

## TURN Server (Self-Hosted)
- **CoTURN**: Open-source TURN/STUN server, configured via Docker for self-hosting.

## Icons and Assets
- **lucide-react**: Icon component library.
- Custom fonts (Inter, JetBrains Mono, Space Grotesk).