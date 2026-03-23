import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Ranks ────────────────────────────────────
  const ranks = [
    { code: 'bronze', title: 'Бронза / Bronze', thresholdCorrectAnswers: 0, icon: '🥉', sortOrder: 1 },
    { code: 'silver', title: 'Серебро / Silver', thresholdCorrectAnswers: 50, icon: '🥈', sortOrder: 2 },
    { code: 'gold', title: 'Золото / Gold', thresholdCorrectAnswers: 150, icon: '🥇', sortOrder: 3 },
    { code: 'platinum', title: 'Платина / Platinum', thresholdCorrectAnswers: 400, icon: '💎', sortOrder: 4 },
    { code: 'magister', title: 'Магистр / Magister', thresholdCorrectAnswers: 1000, icon: '👑', sortOrder: 5 },
  ];

  for (const rank of ranks) {
    await prisma.rank.upsert({
      where: { code: rank.code },
      update: rank,
      create: rank,
    });
  }
  console.log(`✅ Ranks seeded: ${ranks.length}`);

  // ─── Reaction Types ───────────────────────────
  const reactionTypes = [
    { code: 'like', emoji: '👍', label: 'Нравится', sortOrder: 1 },
    { code: 'think', emoji: '🤔', label: 'Думаю', sortOrder: 2 },
    { code: 'fire', emoji: '🔥', label: 'Огонь', sortOrder: 3 },
    { code: 'wow', emoji: '😮', label: 'Вау', sortOrder: 4 },
  ];

  for (const rt of reactionTypes) {
    await prisma.reactionType.upsert({
      where: { code: rt.code },
      update: rt,
      create: rt,
    });
  }
  console.log(`✅ Reaction types seeded: ${reactionTypes.length}`);

  // ─── Admin User ───────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@30sec.game';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin_30sec_2026!';
  const adminNickname = process.env.ADMIN_NICKNAME || 'admin';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const hashedPassword = await argon2.hash(adminPassword);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashedPassword,
        role: UserRole.SUPERADMIN,
        emailVerifiedAt: new Date(),
        isActive: true,
        profile: {
          create: {
            firstName: 'Admin',
            lastName: '30sec',
            nickname: adminNickname,
            language: 'ru',
            countryCode: 'DE',
            flagCode: 'de',
          },
        },
        playerStats: {
          create: {},
        },
      },
    });
    console.log(`✅ Admin user created: ${admin.email}`);
  } else {
    console.log(`ℹ️  Admin user already exists: ${adminEmail}`);
  }

  console.log('🎉 Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
