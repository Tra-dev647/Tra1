import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const D = "/games/ff/diamond.png";
const W = "/games/ff/weekly.png";
const L = "/games/ff/weekly-lite.png";
const E = "/games/ff/evo.png";
const T = "/games/ff/3in1.png";

// Same order and prices as the reference store
const products = [
  { name: "310 Diamonds", amount: 310, priceUsd: 2.89, imageUrl: D },
  { name: "520 Diamonds", amount: 520, priceUsd: 4.89, imageUrl: D },
  { name: "25 Diamonds", amount: 25, priceUsd: 0.3, imageUrl: D },
  { name: "100 Diamonds", amount: 100, priceUsd: 0.99, imageUrl: D },
  { name: "3in1 ×2", amount: 0, priceUsd: 19.9, imageUrl: T },
  { name: "Weekly Pass x2", amount: 0, priceUsd: 3.7, imageUrl: W },
  { name: "Weekly Pass x3", amount: 0, priceUsd: 5.6, imageUrl: W },
  { name: "Weekly Pass x4", amount: 0, priceUsd: 7.7, imageUrl: W },
  { name: "Weekly Pass x5", amount: 0, priceUsd: 8.9, imageUrl: W },
  { name: "Weekly Lite x2", amount: 0, priceUsd: 0.9, imageUrl: L },
  { name: "Weekly Lite x3", amount: 0, priceUsd: 1.5, imageUrl: L },
  { name: "Weekly Lite x4", amount: 0, priceUsd: 2.0, imageUrl: L },
  { name: "Weekly Lite x5", amount: 0, priceUsd: 2.5, imageUrl: L },
  { name: "EVO 3DAYS", amount: 0, priceUsd: 0.69, imageUrl: E },
  { name: "EVO 7DAYS", amount: 0, priceUsd: 0.99, imageUrl: E },
  { name: "EVO 30DAYS", amount: 0, priceUsd: 2.8, imageUrl: E },
];

async function main() {
  const game = await prisma.game.upsert({
    where: { slug: "free-fire" },
    update: { active: true },
    create: {
      slug: "free-fire",
      name: "Garena Free Fire",
      publisher: "Garena",
      description: "Top up Diamonds for Free Fire",
      imageUrl: "/games/ff/diamond.png",
      currencyName: "Diamonds",
      uidLabel: "Player ID",
      uidExample: "1234567890",
      featured: true,
      active: true,
      sortOrder: 2,
    },
  });

  // Only touches Free Fire products. Skip delete if orders already reference them.
  const used = await prisma.order.count({ where: { gameId: game.id } });
  if (used === 0) {
    await prisma.product.deleteMany({ where: { gameId: game.id } });
  } else {
    await prisma.product.updateMany({ where: { gameId: game.id }, data: { active: false } });
  }
  for (let i = 0; i < products.length; i++) {
    await prisma.product.create({ data: { ...products[i], gameId: game.id, sortOrder: i } });
  }
  console.log(`✅ Free Fire: ${products.length} products`);
}

main().finally(() => prisma.$disconnect());
