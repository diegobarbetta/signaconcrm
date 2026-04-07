# SignaCon CRM

Monorepo do **SignaCon CRM** com:

- **API**: Fastify + Prisma (`apps/api`)
- **Web**: React + Vite (`apps/web`)
- **Banco (dev)**: PostgreSQL via Docker Compose (`docker-compose.yml`)

## Estrutura

```
signacon-crm/
  apps/
    api/            # Fastify + Prisma (porta padrão: 3000)
    web/            # React + Vite (porta padrão: 5173)
  docker-compose.yml
  pnpm-workspace.yaml
  package.json
  .env.example
```

## Pré-requisitos

- Node.js **20+**
- PNPM (o projeto usa `pnpm@10.24.0`)
- Docker + Docker Compose (para o Postgres local)

## Setup (primeira vez)

1) Instale dependências na raiz:

```bash
pnpm install
```

2) Configure variáveis de ambiente:

```bash
copy .env.example .env
```

3) Suba o PostgreSQL local:

```bash
pnpm docker:up
```

4) Gere o Prisma Client e rode migrações + seed:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## Rodando em desenvolvimento

Subir **API + Web** em paralelo:

```bash
pnpm dev
```

Ou separado:

```bash
pnpm dev:api
pnpm dev:web
```

- **Web**: `http://localhost:5173`
- **API**: `http://localhost:3000`

## Banco de dados (Prisma)

Comandos úteis (executam o Prisma via `apps/api`):

```bash
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
```

Para abrir o Prisma Studio:

```bash
pnpm --filter @signacon/api db:studio
```

## Docker (PostgreSQL)

- Subir: `pnpm docker:up`
- Descer: `pnpm docker:down`
- Resetar volume (apaga dados): `pnpm docker:reset`

## Variáveis de ambiente

O arquivo `.env.example` documenta todas as chaves usadas atualmente (Postgres, API, JWT, seed e integrações futuras).

- **Importante**: não commite `.env` com segredos reais.

