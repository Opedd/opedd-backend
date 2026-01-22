# Story Protocol Export Plan

## Overview

Story Protocol is a blockchain-based IP infrastructure that enables programmable IP licensing. This document outlines the plan to export Opedd licenses to Story Protocol for on-chain registration.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Opedd API     │────▶│  Export Service │────▶│ Story Protocol  │
│   (Licenses)    │     │  (Queue Worker) │     │   (On-chain)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │
         │                      ▼
         │              ┌─────────────────┐
         │              │   IPFS/Arweave  │
         │              │   (Metadata)    │
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐
│    Supabase     │
│  (Export Log)   │
└─────────────────┘
```

## Implementation Phases

### Phase 1: Data Model Extension

Add Story Protocol fields to licenses table:

```sql
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS story_protocol_ip_id VARCHAR(66);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS story_protocol_tx_hash VARCHAR(66);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS story_protocol_status VARCHAR(20)
  DEFAULT 'pending' CHECK (story_protocol_status IN ('pending', 'processing', 'registered', 'failed'));
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS story_protocol_exported_at TIMESTAMPTZ;
```

### Phase 2: Export Service

Create new use case: `ExportToStoryProtocolUseCase`

```typescript
// src/use-cases/ExportToStoryProtocolUseCase.ts

interface StoryProtocolExportInput {
  licenseId: string;
  walletAddress: string; // Publisher's wallet for IP ownership
}

interface StoryProtocolExportResult {
  ipId: string;
  txHash: string;
  explorerUrl: string;
}
```

### Phase 3: Story Protocol SDK Integration

Dependencies:
```json
{
  "@story-protocol/core-sdk": "^1.x",
  "viem": "^2.x"
}
```

Key Integration Points:
1. **IP Asset Registration** - Register license as IP Asset
2. **License Terms** - Map Opedd license types to PIL (Programmable IP License)
3. **Metadata Upload** - Store license metadata on IPFS

### Phase 4: License Type Mapping

| Opedd Type      | Story Protocol PIL Template |
|-----------------|----------------------------|
| standard        | Non-Commercial Social      |
| exclusive       | Commercial Use             |
| creative_commons| Non-Commercial Social (CC) |

### Phase 5: New Endpoints

```
POST /api/v1/licenses/:id/export-story-protocol
  - Initiates export to Story Protocol
  - Requires wallet signature

GET /api/v1/licenses/:id/story-protocol-status
  - Returns export status and on-chain details
```

### Phase 6: Webhook/Background Processing

Use a job queue (Bull/BullMQ) for:
1. Uploading metadata to IPFS
2. Submitting transaction to Story Protocol
3. Confirming transaction
4. Updating database status

## Security Considerations

1. **Wallet Verification** - Publisher must prove wallet ownership
2. **Idempotency** - Prevent duplicate exports
3. **Rate Limiting** - Limit exports per publisher
4. **Transaction Signing** - Use EIP-712 typed data for signatures

## Database Schema Addition

```sql
-- Story Protocol export tracking
CREATE TABLE IF NOT EXISTS story_protocol_exports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_id UUID REFERENCES licenses(id) ON DELETE CASCADE NOT NULL,
  ip_id VARCHAR(66),
  tx_hash VARCHAR(66),
  status VARCHAR(20) DEFAULT 'pending',
  wallet_address VARCHAR(42) NOT NULL,
  metadata_cid VARCHAR(100),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_sp_exports_license ON story_protocol_exports(license_id);
CREATE INDEX idx_sp_exports_status ON story_protocol_exports(status);
```

## Environment Variables

```env
# Story Protocol
STORY_PROTOCOL_RPC_URL=https://odyssey.storyrpc.io
STORY_PROTOCOL_CHAIN_ID=1516
STORY_PROTOCOL_NFT_CONTRACT=0x...

# IPFS
IPFS_GATEWAY_URL=https://ipfs.io/ipfs
PINATA_API_KEY=your-key
PINATA_SECRET_KEY=your-secret
```

## Timeline Estimate

1. **Phase 1-2**: Database + Use Case scaffolding
2. **Phase 3**: SDK Integration + Testing on testnet
3. **Phase 4-5**: API Endpoints + Frontend integration
4. **Phase 6**: Background jobs + Production deployment

## References

- [Story Protocol Documentation](https://docs.story.foundation/)
- [Story Protocol SDK](https://github.com/storyprotocol/sdk)
- [PIL License Templates](https://docs.story.foundation/concepts/programmable-ip-license)
