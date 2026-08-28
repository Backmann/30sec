import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Ranks ────────────────────────────────────
  // WARNING: `update: rank` below overwrites existing rows, so these values must
  // stay in sync with production. They previously did not: the file still had
  // five ranks with thresholds 0/50/150/400/1000 while the database had six
  // with 0/50/150/300/500/750, and rerunning the seed would have silently
  // corrupted every player's rank. Values below are taken from production.
  const ranks = [
    { code: 'wooden', title: 'Деревянный', thresholdCorrectAnswers: 0, icon: '🪵', sortOrder: 1 },
    { code: 'bronze', title: 'Бронза', thresholdCorrectAnswers: 50, icon: '🥉', sortOrder: 2 },
    { code: 'silver', title: 'Серебро', thresholdCorrectAnswers: 150, icon: '🥈', sortOrder: 3 },
    { code: 'gold', title: 'Золото', thresholdCorrectAnswers: 300, icon: '🥇', sortOrder: 4 },
    { code: 'platinum', title: 'Платина', thresholdCorrectAnswers: 500, icon: '💎', sortOrder: 5 },
    { code: 'magister', title: 'Магистр', thresholdCorrectAnswers: 750, icon: '👑', sortOrder: 6 },
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

  // ─── Achievements ─────────────────────────────
  // These live only in the database until now: a rebuilt environment would
  // have started with zero achievements and nothing would ever unlock.
  const achievements = [
    { code: 'first_login', title: 'Первый шаг', description: 'Зарегистрировались на 30sec.', icon: '🎉', category: 'onboarding', sortOrder: 1 },
    { code: 'first_answer', title: 'Проба пера', description: 'Ответили на первый вопрос', icon: '✍️', category: 'onboarding', sortOrder: 2 },
    { code: 'profile_complete', title: 'Лицо сообщества', description: 'Заполнили профиль (аватар + био + страна)', icon: '🌟', category: 'onboarding', sortOrder: 3 },
    { code: 'first_win', title: 'Первая победа', description: 'Выиграли первый турнир', icon: '🏆', category: 'wins', sortOrder: 10 },
    { code: 'wins_5', title: 'Опытный игрок', description: '5 побед в турнирах', icon: '🥉', category: 'wins', sortOrder: 11 },
    { code: 'wins_10', title: 'Чемпион', description: '10 побед в турнирах', icon: '🥈', category: 'wins', sortOrder: 12 },
    { code: 'wins_25', title: 'Легенда', description: '25 побед в турнирах', icon: '🥇', category: 'wins', sortOrder: 13 },
    { code: 'sharp_shooter', title: 'Меткий стрелок', description: 'Точность 80%+ за турнир (минимум 10 ответов)', icon: '🎯', category: 'accuracy', sortOrder: 20 },
    { code: 'perfect_round', title: 'Без промаха', description: '100% точность в турнире', icon: '💯', category: 'accuracy', sortOrder: 21 },
    { code: 'quick_draw', title: 'Быстрая рука', description: 'Правильный ответ за 5 секунд', icon: '⚡', category: 'speed', sortOrder: 30 },
    { code: 'streak_3', title: 'В ударе', description: '3 правильных ответа подряд', icon: '🔥', category: 'streaks', sortOrder: 40 },
    { code: 'streak_5', title: 'На огне', description: '5 правильных ответов подряд', icon: '🔥', category: 'streaks', sortOrder: 41 },
    { code: 'streak_10', title: 'Неудержимый', description: '10 правильных ответов подряд', icon: '🔥', category: 'streaks', sortOrder: 42 },
    { code: 'decisive_winner', title: 'В решающем', description: 'Победа в решающем вопросе 11:11', icon: '⚔️', category: 'decisive', sortOrder: 50 },
    { code: 'creator_1', title: 'Автор', description: 'Создали первый вопрос', icon: '✒️', category: 'creator', sortOrder: 60 },
    { code: 'creator_10', title: 'Мастер пера', description: 'Создали 10 вопросов', icon: '📝', category: 'creator', sortOrder: 61 },
    { code: 'best_question', title: 'Автор лучшего вопроса', description: 'Ваш вопрос выбрали лучшим в турнире', icon: '⭐', category: 'creator', sortOrder: 62 },
    { code: 'first_vote', title: 'Мнение имеет значение', description: 'Проголосовали за лучший вопрос', icon: '🗳️', category: 'social', sortOrder: 70 },
    { code: 'spectator', title: 'Преданный зритель', description: 'Посмотрели 5 турниров как зритель', icon: '👀', category: 'social', sortOrder: 71 },
    { code: 'weekly_streak', title: 'Верность', description: 'Заходили 7 дней подряд', icon: '📅', category: 'activity', sortOrder: 80 },
    { code: 'monthly_streak', title: 'Постоянный игрок', description: 'Заходили 30 дней в течение месяца', icon: '🏅', category: 'activity', sortOrder: 81 },
  ];
  for (const a of achievements) {
    await prisma.achievement.upsert({
      where: { code: a.code },
      update: a,
      create: a,
    });
  }
  console.log(`✅ Achievements seeded: ${achievements.length}`);

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
