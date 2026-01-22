# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server with hot reload (nodemon + ts-node)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled code from dist/

# Testing
npm test             # Run all tests once
npm run test:watch   # Run tests in watch mode

# Run a single test file
npx vitest run tests/licenses.test.ts
```

## Architecture

This is an Express 5 backend using clean architecture with Supabase as the database and auth provider.

### Layer Structure

```
src/
├── entities/       # Domain models (License, User, Publisher) with DTOs
├── use-cases/      # Business logic (CreateLicenseUseCase, SignupUseCase, etc.)
├── controllers/    # HTTP request handlers - instantiate use cases with repos
├── routes/         # Express route definitions
├── repos/          # Repository pattern implementations (SupabaseLicenseRepo, etc.)
├── middleware/     # Auth, validation, rate limiting, error handling
└── utils/          # Validators (Zod schemas), errors, logger
```

**Data flow:** Routes → Controllers → Use Cases → Repositories → Supabase

### Path Aliases

TypeScript path aliases are configured in tsconfig.json:
- `@entities/*`, `@use-cases/*`, `@controllers/*`, `@repos/*`, `@utils/*`, `@middleware/*`

### Key Patterns

- **Repositories** accept `accessToken` parameter to create user-scoped Supabase clients that respect RLS
- **Use cases** receive injected repositories for testability
- **Controllers** instantiate use cases with concrete repo implementations
- **Entities** have both domain interfaces and DTO variants with `toXxxDTO()` converters

### API Structure

All routes mounted under `/api/v1`:
- `/auth` - Signup/login (returns Supabase JWT)
- `/licenses` - CRUD for licenses (requires auth)
- `/health` - Health check at root

### Error Handling

Custom error classes in `utils/errors.ts` (AppError, ValidationError, AuthenticationError, etc.) are caught by the global error handler and returned as:
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

### Database

Schema in `supabase/schema.sql`. Two main tables:
- `publishers` - Linked to Supabase auth users
- `licenses` - Belong to publishers, have types: standard, exclusive, creative_commons

RLS policies ensure users can only access their own data.

## Environment Variables

Copy `.env.example` to `.env`:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` - Required for Supabase
- `PORT` - Server port (default 3000)
- `CORS_ORIGIN` - Allowed CORS origin
