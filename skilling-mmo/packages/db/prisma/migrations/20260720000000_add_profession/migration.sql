-- AlterTable
CREATE TYPE "Profession" AS ENUM ('WOODSMAN', 'FARMER', 'MINER');

ALTER TABLE "Player" ADD COLUMN "profession" "Profession" NOT NULL DEFAULT 'WOODSMAN';
