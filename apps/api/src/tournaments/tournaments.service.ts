import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queues/queue.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

const RQ = 23;

const TEST_QUESTIONS = [
  { ru: ['Какое число следует: 2, 4, 8, 16, ?', '32'], de: ['Welche Zahl folgt: 2, 4, 8, 16, ?', '32'], en: ['What number follows: 2, 4, 8, 16, ?', '32'] },
  { ru: ['Столица Франции?', 'Париж'], de: ['Hauptstadt von Frankreich?', 'Paris'], en: ['Capital of France?', 'Paris'] },
  { ru: ['Сколько будет 7 × 8?', '56'], de: ['Wie viel ist 7 × 8?', '56'], en: ['What is 7 × 8?', '56'] },
  { ru: ['Какой газ мы вдыхаем?', 'Кислород'], de: ['Welches Gas atmen wir ein?', 'Sauerstoff'], en: ['What gas do we breathe?', 'Oxygen'] },
  { ru: ['Сколько планет в Солнечной системе?', '8'], de: ['Wie viele Planeten hat unser Sonnensystem?', '8'], en: ['How many planets in the Solar System?', '8'] },
  { ru: ['Кто написал «Войну и мир»?', 'Толстой'], de: ['Wer schrieb "Krieg und Frieden"?', 'Tolstoi'], en: ['Who wrote "War and Peace"?', 'Tolstoy'] },
  { ru: ['Химический символ воды?', 'H2O'], de: ['Chemisches Symbol für Wasser?', 'H2O'], en: ['Chemical symbol for water?', 'H2O'] },
  { ru: ['В каком году началась Вторая мировая война?', '1939'], de: ['In welchem Jahr begann der 2. Weltkrieg?', '1939'], en: ['What year did WWII start?', '1939'] },
  { ru: ['Самая длинная река в мире?', 'Нил'], de: ['Längster Fluss der Welt?', 'Nil'], en: ['Longest river in the world?', 'Nile'] },
  { ru: ['Столица Германии?', 'Берлин'], de: ['Hauptstadt von Deutschland?', 'Berlin'], en: ['Capital of Germany?', 'Berlin'] },
  { ru: ['Сколько секунд в минуте?', '60'], de: ['Wie viele Sekunden hat eine Minute?', '60'], en: ['How many seconds in a minute?', '60'] },
  { ru: ['Какой элемент обозначается Fe?', 'Железо'], de: ['Welches Element hat das Symbol Fe?', 'Eisen'], en: ['What element is Fe?', 'Iron'] },
  { ru: ['Кто изобрёл телефон?', 'Белл'], de: ['Wer erfand das Telefon?', 'Bell'], en: ['Who invented the telephone?', 'Bell'] },
  { ru: ['Сколько материков на Земле?', '6'], de: ['Wie viele Kontinente gibt es?', '6'], en: ['How many continents on Earth?', '6'] },
  { ru: ['Самое большое млекопитающее?', 'Кит'], de: ['Größtes Säugetier?', 'Blauwal'], en: ['Largest mammal?', 'Blue whale'] },
  { ru: ['Корень из 144?', '12'], de: ['Wurzel aus 144?', '12'], en: ['Square root of 144?', '12'] },
  { ru: ['В каком городе Эйфелева башня?', 'Париж'], de: ['In welcher Stadt steht der Eiffelturm?', 'Paris'], en: ['What city is the Eiffel Tower in?', 'Paris'] },
  { ru: ['Сколько хромосом у человека?', '46'], de: ['Wie viele Chromosomen hat der Mensch?', '46'], en: ['How many chromosomes do humans have?', '46'] },
  { ru: ['Скорость света км/с (округлённо)?', '300000'], de: ['Lichtgeschwindigkeit km/s (gerundet)?', '300000'], en: ['Speed of light km/s (rounded)?', '300000'] },
  { ru: ['Столица Японии?', 'Токио'], de: ['Hauptstadt von Japan?', 'Tokio'], en: ['Capital of Japan?', 'Tokyo'] },
  { ru: ['Формула Пифагора: a² + b² = ?', 'c²'], de: ['Satz des Pythagoras: a² + b² = ?', 'c²'], en: ['Pythagorean theorem: a² + b² = ?', 'c²'] },
  { ru: ['Кто нарисовал «Мону Лизу»?', 'Да Винчи'], de: ['Wer malte die Mona Lisa?', 'Da Vinci'], en: ['Who painted the Mona Lisa?', 'Da Vinci'] },
  { ru: ['Сколько нот в октаве?', '7'], de: ['Wie viele Noten hat eine Oktave?', '7'], en: ['How many notes in an octave?', '7'] },
];

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {}

  // Helper: notify user in-app + email
  private async notifyUser(userId: string, title: string, body: string, sendEmail = true) {
    await this.notifications.create(userId, { type: 'TOURNAMENT', title, body, channel: 'IN_APP' });
    if (sendEmail) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
      if (user) {
        await this.queue.queueEmail({
          type: 'notification',
          to: user.email,
          language: user.profile?.language || 'ru',
          data: { title, body },
        });
      }
    }
  }

  async create(dto: CreateTournamentDto, adminId: string) {
    if (!dto.startAt) throw new BadRequestException('Укажите дату и время старта');
    const t = await this.prisma.tournament.create({
      data: { title: dto.title, type: dto.type, theme: dto.theme || null, startAt: new Date(dto.startAt), maxPlayers: null, createdBy: adminId },
    });

    // Schedule 15-min reminder
    if (t.startAt) {
      await this.queue.scheduleTournamentReminder(t.id, t.startAt);
    }

    this.realtime.broadcastTournamentListUpdate();
    return t;
  }

  async update(id: string, dto: UpdateTournamentDto) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Не найден');
    if (t.status === 'LIVE') throw new BadRequestException('Нельзя редактировать запущенный');
    if (t.status === 'FINISHED') throw new BadRequestException('Нельзя редактировать завершённый');
    const u = await this.prisma.tournament.update({
      where: { id }, data: { title: dto.title ?? undefined, theme: dto.theme ?? undefined, startAt: dto.startAt ? new Date(dto.startAt) : undefined, status: dto.status ?? undefined },
    });

    // Re-schedule reminder if startAt was updated
    if (dto.startAt && u.startAt) {
      await this.queue.scheduleTournamentReminder(u.id, u.startAt);
    }

    this.realtime.broadcastTournamentListUpdate();
    return u;
  }

  async start(id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id }, include: { tournamentQuestions: true, participants: true } });
    if (!t) throw new NotFoundException('Не найден');
    if (t.status === 'LIVE') throw new BadRequestException('Уже идёт');
    if (t.status === 'FINISHED') throw new BadRequestException('Уже завершён');
    if (t.tournamentQuestions.length < RQ) throw new BadRequestException(`Нужно ${RQ} вопросов. Сейчас: ${t.tournamentQuestions.length}`);
    if (t.startAt && new Date() < new Date(t.startAt)) throw new BadRequestException('Время старта ещё не наступило');
    if (t.participants.filter(p => p.matchStatus === 'APPROVED').length === 0) throw new BadRequestException('Нет одобренных участников');

    const u = await this.prisma.tournament.update({ where: { id }, data: { status: 'LIVE', startAt: new Date() } });
    await this.queue.cancelTournamentReminder(id);
    // Set approved participants to PLAYING
    await this.prisma.tournamentParticipant.updateMany({ where: { tournamentId: id, matchStatus: 'APPROVED' }, data: { matchStatus: 'PLAYING' } });

    // Notify all participants that tournament started
    const playingParticipants = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId: id, matchStatus: 'PLAYING' },
      select: { userId: true },
    });
    for (const p of playingParticipants) {
      await this.notifyUser(
        p.userId,
        'Турнир начался! 🎮',
        `Турнир "${u.title}" только что стартовал. Заходите играть прямо сейчас!`,
      );
    }

    this.realtime.tournamentStarted(id, { title: u.title, type: u.type });
    this.realtime.broadcastTournamentListUpdate();
    return u;
  }

  async finish(id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Не найден');
    const u = await this.prisma.tournament.update({ where: { id }, data: { status: 'FINISHED', endAt: new Date() } });
    // Return unused questions back to library (delete tournament_questions where isUsed=false)
    await this.prisma.tournamentQuestion.deleteMany({
      where: { tournamentId: id, isUsed: false },
    });

    // Notify all participants about tournament end + invite to vote
    const participants = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId: id, matchStatus: { in: ['PLAYING', 'WON', 'LOST', 'FINISHED'] } },
      select: { userId: true },
    });
    for (const p of participants) {
      await this.notifyUser(
        p.userId,
        'Турнир завершён 🏆',
        `Турнир "${u.title}" завершён. У вас 48 часов, чтобы проголосовать за лучший вопрос! ⭐`,
      );
    }

    this.realtime.tournamentFinished(id);
    this.realtime.broadcastTournamentListUpdate();
    return u;
  }

  async remove(id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Не найден');
    if (t.status === 'LIVE') throw new BadRequestException('Нельзя удалить активный');
    await this.queue.cancelTournamentReminder(id);
    await this.prisma.tournamentQuestion.deleteMany({ where: { tournamentId: id } });
    await this.prisma.judgement.deleteMany({ where: { answer: { tournamentId: id } } });
    await this.prisma.answer.deleteMany({ where: { tournamentId: id } });
    await this.prisma.tournamentParticipant.deleteMany({ where: { tournamentId: id } });
    await this.prisma.questionVote.deleteMany({ where: { tournamentId: id } });
    await this.prisma.spectatorAnswer.deleteMany({ where: { tournamentId: id } });
    await this.prisma.tournament.delete({ where: { id } });
    this.realtime.broadcastTournamentListUpdate();
    return { deleted: true };
  }

  // Player applies to join (status: PENDING)
  async join(tournamentId: string, userId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Не найден');
    if (t.status === 'FINISHED') throw new BadRequestException('Турнир завершён');

    const existing = await this.prisma.tournamentParticipant.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (existing) return existing;

    const participant = await this.prisma.tournamentParticipant.create({
      data: { userId, tournamentId, matchStatus: 'PENDING' },
    });

    // Notify admins about new application (in-app only, no email spam)
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true },
      select: { id: true },
    });
    const applicant = await this.prisma.profile.findUnique({ where: { userId }, select: { nickname: true } });
    for (const admin of admins) {
      await this.notifications.create(admin.id, {
        type: 'ADMIN_APPLICATION',
        title: 'Новая заявка на турнир',
        body: `${applicant?.nickname || 'Игрок'} подал заявку на "${t.title}"`,
        channel: 'IN_APP',
      });
    }

    this.realtime.broadcastTournamentListUpdate();
    return participant;
  }

  // Admin approves participant
  async approveParticipant(participantId: string) {
    const p = await this.prisma.tournamentParticipant.findUnique({
      where: { id: participantId },
      include: { tournament: { select: { title: true } } },
    });
    if (!p) throw new NotFoundException('Участник не найден');

    // Idempotency: skip if already approved (prevents duplicate notifications on double-click)
    if (p.matchStatus === 'APPROVED') return p;

    const updated = await this.prisma.tournamentParticipant.update({ where: { id: participantId }, data: { matchStatus: 'APPROVED' } });

    await this.notifyUser(
      p.userId,
      'Заявка одобрена ✓',
      `Вы допущены к турниру "${p.tournament.title}". Ждём вас на старте!`,
    );

    return updated;
  }

  // Admin rejects participant
  async rejectParticipant(participantId: string) {
    const p = await this.prisma.tournamentParticipant.findUnique({
      where: { id: participantId },
      include: { tournament: { select: { title: true } } },
    });
    if (!p) throw new NotFoundException('Участник не найден');

    // Idempotency: skip if already rejected
    if (p.matchStatus === 'REJECTED') return p;

    const updated = await this.prisma.tournamentParticipant.update({ where: { id: participantId }, data: { matchStatus: 'REJECTED' } });

    await this.notifyUser(
      p.userId,
      'Заявка отклонена',
      `К сожалению, ваша заявка на турнир "${p.tournament.title}" была отклонена. Не расстраивайтесь, попробуйте другие турниры!`,
    );

    return updated;
  }

  async launchNextQuestion(tournamentId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Не найден');
    if (t.status !== 'LIVE') throw new BadRequestException('Турнир не активен');

    const next = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId, isUsed: false }, orderBy: { orderIndex: 'asc' },
      include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } },
    });
    if (!next) throw new BadRequestException('Вопросы закончились');

    await this.prisma.tournamentQuestion.update({ where: { id: next.id }, data: { isUsed: true } });

    this.realtime.questionStarted(tournamentId, {
      tournamentQuestionId: next.id, questionId: next.question.id, orderIndex: next.orderIndex,
      category: next.question.category,
      localizations: next.question.localizations.map(l => ({ language: l.language, questionText: l.questionText })),
      questionImages: (next.question as any).questionImages || [],
    });

    return { launched: true, orderIndex: next.orderIndex, questionId: next.question.id, tournamentQuestionId: next.id };
  }

  // Fill 23 test questions for quick testing
  async fillTestQuestions(tournamentId: string, adminId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId }, include: { tournamentQuestions: true } });
    if (!t) throw new NotFoundException('Не найден');

    const existing = t.tournamentQuestions.length;
    const needed = RQ - existing;
    if (needed <= 0) throw new BadRequestException(`Уже есть ${existing} вопросов`);

    let added = 0;
    for (let i = 0; i < Math.min(needed, TEST_QUESTIONS.length); i++) {
      const tq = TEST_QUESTIONS[(existing + i) % TEST_QUESTIONS.length];
      const locs: any[] = [];
      if (tq.ru) locs.push({ language: 'ru', questionText: tq.ru[0], correctAnswerLocalized: tq.ru[1] });
      if (tq.de) locs.push({ language: 'de', questionText: tq.de[0], correctAnswerLocalized: tq.de[1] });
      if (tq.en) locs.push({ language: 'en', questionText: tq.en[0], correctAnswerLocalized: tq.en[1] });

      const q = await this.prisma.question.create({
        data: { category: 'LOGIC', createdBy: adminId, localizations: { create: locs } },
      });
      await this.prisma.tournamentQuestion.create({
        data: { tournamentId, questionId: q.id, orderIndex: existing + i },
      });
      added++;
    }

    this.realtime.broadcastTournamentListUpdate();
    return { added, total: existing + added };
  }


  // Remove correct answers from questions unless user is admin
  private sanitizeQuestions(tournamentData: any, isAdmin: boolean) {
    if (isAdmin) return tournamentData;
    if (tournamentData.tournamentQuestions) {
      tournamentData.tournamentQuestions = tournamentData.tournamentQuestions.map((tq: any) => ({
        ...tq,
        question: tq.question ? {
          ...tq.question,
          localizations: tq.question.localizations?.map((l: any) => ({
            ...l,
            correctAnswerLocalized: undefined,
          })),
        } : tq.question,
      }));
    }
    return tournamentData;
  }

  async findAll(userId: string, status?: string) {
    const where = status ? { status: status as any } : {};
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
    const tournaments = await this.prisma.tournament.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { participants: true } },
        participants: { include: { user: { include: { profile: { select: { nickname: true } } } } } },
        tournamentQuestions: { orderBy: { orderIndex: 'asc' }, include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } } },
      },
    });
    return tournaments.map(t => this.sanitizeQuestions(t, isAdmin));
  }

  async findOne(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
    const t = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        participants: { include: { user: { include: { profile: { select: { nickname: true, flagCode: true } } } } }, orderBy: { currentScoreUser: 'desc' } },
        tournamentQuestions: { orderBy: { orderIndex: 'asc' }, include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } } },
        _count: { select: { participants: true } },
      },
    });
    if (!t) throw new NotFoundException('Не найден');
    return this.sanitizeQuestions(t, isAdmin);
  }

  // ─── Live broadcast state for admin's live observation page ─────
  async getLiveState(tournamentId: string, userId: string) {
    // Verify admin role
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
    if (!isAdmin) throw new NotFoundException('Not found');

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        tournamentQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } },
        },
        participants: {
          where: { matchStatus: { in: ['APPROVED', 'PLAYING', 'WON', 'LOST', 'FINISHED'] } },
          include: {
            user: { include: { profile: { select: { nickname: true, countryCode: true, flagCode: true } } } },
          },
          orderBy: { currentScoreUser: 'desc' },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const currentTQ = tournament.tournamentQuestions.filter(tq => tq.isUsed).pop();
    const totalQuestions = tournament.tournamentQuestions.length;
    const currentQuestionNumber = tournament.tournamentQuestions.filter(tq => tq.isUsed).length;
    const remainingQuestions = totalQuestions - currentQuestionNumber;

    // Live phase + timer from realtime gateway
    const gameState = this.realtime.getGameState(tournamentId);
    let phase = 'idle';
    let timerSeconds = 0;
    if (gameState) {
      const now = Date.now();
      if (now < gameState.readingEndsAt) {
        phase = 'reading';
        timerSeconds = Math.ceil((gameState.readingEndsAt - now) / 1000);
      } else if (now < gameState.answeringEndsAt) {
        phase = 'answering';
        timerSeconds = Math.ceil((gameState.answeringEndsAt - now) / 1000);
      } else {
        phase = 'judging';
      }
    }

    // Get all answers for current question (for judging)
    let currentAnswers: any[] = [];
    if (currentTQ) {
      const answers = await this.prisma.answer.findMany({
        where: { tournamentId, questionId: currentTQ.questionId },
        include: {
          user: { include: { profile: { select: { nickname: true, countryCode: true, flagCode: true } } } },
          judgement: true,
        },
        orderBy: { submittedAt: 'asc' },
      });
      currentAnswers = answers.map(a => ({
        id: a.id,
        userId: a.userId,
        nickname: a.user.profile?.nickname || 'Anonymous',
        countryCode: a.user.profile?.countryCode,
        flagCode: a.user.profile?.flagCode,
        answerText: a.answerText,
        submittedAt: a.submittedAt,
        judged: !!a.judgement,
        decision: a.judgement?.decision || null,
      }));
    }

    // Spectator stats
    const spectatorCount = await this.prisma.spectatorAnswer.findMany({
      where: { tournamentId, questionId: currentTQ?.questionId },
      distinct: ['userId'],
    }).then(rows => rows.length);

    return {
      tournament: {
        id: tournament.id,
        title: tournament.title,
        type: tournament.type,
        status: tournament.status,
        startAt: tournament.startAt,
      },
      progress: {
        totalQuestions,
        currentQuestionNumber,
        remainingQuestions,
      },
      phase,
      timerSeconds,
      currentQuestion: currentTQ ? {
        tqId: currentTQ.id,
        questionId: currentTQ.questionId,
        orderIndex: currentTQ.orderIndex,
        localizations: currentTQ.question.localizations.map(l => ({
          language: l.language,
          questionText: l.questionText,
          correctAnswer: l.correctAnswerLocalized,
        })),
        questionImages: (currentTQ.question as any).questionImages || [],
        answerImages: (currentTQ.question as any).answerImages || [],
      } : null,
      participants: tournament.participants.map(p => ({
        id: p.id,
        userId: p.userId,
        nickname: p.user.profile?.nickname || 'Anonymous',
        countryCode: p.user.profile?.countryCode,
        flagCode: p.user.profile?.flagCode,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
        matchStatus: p.matchStatus,
      })),
      currentAnswers,
      spectatorCount,
    };
  }


  // ─── Public live state for OBS / stream viewers (no auth, no secrets) ──
  async getPublicLive(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        tournamentQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } },
        },
        participants: {
          where: { matchStatus: { in: ['APPROVED', 'PLAYING', 'WON', 'LOST', 'FINISHED'] } },
          include: {
            user: { include: { profile: { select: { nickname: true, countryCode: true, flagCode: true } } } },
          },
          orderBy: { currentScoreUser: 'desc' },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const currentTQ = tournament.tournamentQuestions.filter(tq => tq.isUsed).pop();
    const totalQuestions = tournament.tournamentQuestions.length;
    const currentQuestionNumber = tournament.tournamentQuestions.filter(tq => tq.isUsed).length;
    const remainingQuestions = totalQuestions - currentQuestionNumber;

    const gameState = this.realtime.getGameState(tournamentId);
    let phase = 'idle';
    let timerSeconds = 0;
    if (gameState) {
      const now = Date.now();
      if (now < gameState.readingEndsAt) {
        phase = 'reading';
        timerSeconds = Math.ceil((gameState.readingEndsAt - now) / 1000);
      } else if (now < gameState.answeringEndsAt) {
        phase = 'answering';
        timerSeconds = Math.ceil((gameState.answeringEndsAt - now) / 1000);
      } else {
        phase = 'judging';
      }
    }

    // For public: only show answers after they are judged (no spoilers)
    let currentAnswers: any[] = [];
    if (currentTQ && phase === 'judging') {
      const answers = await this.prisma.answer.findMany({
        where: { tournamentId, questionId: currentTQ.questionId },
        include: {
          user: { include: { profile: { select: { nickname: true, flagCode: true } } } },
          judgement: true,
        },
        orderBy: { submittedAt: 'asc' },
      });
      currentAnswers = answers
        .filter(a => a.judgement) // only show ALREADY JUDGED answers
        .map(a => ({
          id: a.id,
          nickname: a.user.profile?.nickname || 'Anonymous',
          flagCode: a.user.profile?.flagCode || null,
          answerText: a.answerText,
          decision: a.judgement?.decision || null,
        }));
    }

    return {
      tournament: {
        id: tournament.id,
        title: tournament.title,
        status: tournament.status,
        startAt: tournament.startAt,
      },
      progress: { totalQuestions, currentQuestionNumber, remainingQuestions },
      phase,
      timerSeconds,
      currentQuestion: currentTQ ? {
        questionId: currentTQ.questionId,
        orderIndex: currentTQ.orderIndex,
        // NO correct answer for public feed
        localizations: currentTQ.question.localizations.map(l => ({
          language: l.language,
          questionText: l.questionText,
        })),
        questionImages: (currentTQ.question as any).questionImages || [],
        // Answer images only visible during judging (after reveal)
        answerImages: phase === 'judging' ? ((currentTQ.question as any).answerImages || []) : [],
      } : null,
      participants: tournament.participants.map(p => ({
        id: p.id,
        nickname: p.user.profile?.nickname || 'Anonymous',
        flagCode: p.user.profile?.flagCode || null,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
        matchStatus: p.matchStatus,
      })),
      currentAnswers,
    };
  }

  async leaderboard(tid: string) {
    return this.prisma.tournamentParticipant.findMany({
      where: { tournamentId: tid }, orderBy: [{ currentScoreUser: 'desc' }, { currentScoreSystem: 'asc' }],
      include: { user: { include: { profile: { select: { nickname: true, flagCode: true, countryCode: true } } } } },
    });
  }

  /** Extends reading phase by N seconds. Returns true if extended, false if not in reading phase */
  extendReading(tournamentId: string, seconds: number = 10): boolean {
    return this.realtime.extendReading(tournamentId, seconds);
  }

  async getCurrentQuestion(tid: string) {
    return this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId: tid, isUsed: false }, orderBy: { orderIndex: 'asc' },
      include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } },
    });
  }

  async markQuestionUsed(tqId: string) {
    return this.prisma.tournamentQuestion.update({ where: { id: tqId }, data: { isUsed: true } });
  }

  // Get current game state for reconnect
  async getGameState(tournamentId: string, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        tournamentQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: { include: { localizations: true, questionImages: { orderBy: { orderIndex: 'asc' } }, answerImages: { orderBy: { orderIndex: 'asc' } } } } },
        },
        participants: { include: { user: { include: { profile: { select: { nickname: true } } } } } },
      },
    });
    if (!tournament) return { status: 'NOT_FOUND' };

    // Find last used question
    const lastUsed = tournament.tournamentQuestions.filter(tq => tq.isUsed).pop();
    
    // Find my participant
    const myParticipant = tournament.participants.find(p => p.userId === userId);
    
    // Find my answer for current question
    let myAnswer = null;
    if (lastUsed) {
      myAnswer = await this.prisma.answer.findFirst({
        where: { tournamentId, questionId: lastUsed.questionId, userId },
        include: { judgement: true },
      });
    }

    // Get all answers for current question (admin)
    let allAnswers: any[] = [];
    if (lastUsed) {
      allAnswers = await this.prisma.answer.findMany({
        where: { tournamentId, questionId: lastUsed.questionId },
        include: { user: { include: { profile: { select: { nickname: true } } } }, judgement: true },
        orderBy: { submittedAt: 'asc' },
      });
    }

    // Get realtime phase from gateway
    const gameState = this.realtime.getGameState(tournamentId);
    let phase = 'idle';
    let timerSeconds = 0;
    if (gameState) {
      const now = Date.now();
      if (now < gameState.readingEndsAt) {
        phase = 'reading';
        timerSeconds = Math.ceil((gameState.readingEndsAt - now) / 1000);
      } else if (now < gameState.answeringEndsAt) {
        phase = 'answering';
        timerSeconds = Math.ceil((gameState.answeringEndsAt - now) / 1000);
      } else {
        phase = 'judging';
      }
    }

    // Load user role to decide if correct answer should be exposed
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPERADMIN';
    // Show correct answer only when: admin, OR judging phase, OR user already answered and got judgement
    const userAlreadyJudged = !!(myAnswer && myAnswer.judgement);
    const canSeeCorrectAnswer = isAdmin || phase === 'judging' || userAlreadyJudged;

    return {
      status: tournament.status,
      currentQuestion: lastUsed ? {
        questionId: lastUsed.questionId,
        orderIndex: lastUsed.orderIndex,
        localizations: lastUsed.question.localizations.map(l => ({
          language: l.language,
          questionText: l.questionText,
          correctAnswer: canSeeCorrectAnswer ? l.correctAnswerLocalized : undefined,
        })),
        questionImages: (lastUsed.question as any).questionImages || [],
        answerImages: canSeeCorrectAnswer ? ((lastUsed.question as any).answerImages || []) : [],
      } : null,
      phase,
      timerSeconds,
      myParticipant: myParticipant ? {
        matchStatus: myParticipant.matchStatus,
        scoreUser: myParticipant.currentScoreUser,
        scoreSystem: myParticipant.currentScoreSystem,
      } : null,
      myAnswer: myAnswer ? {
        answerText: myAnswer.answerText,
        judgement: myAnswer.judgement ? {
          decision: myAnswer.judgement.decision,
        } : null,
      } : null,
      allAnswers: allAnswers.map(a => ({
        id: a.id,
        answerText: a.answerText,
        user: { profile: { nickname: a.user?.profile?.nickname } },
        judgement: a.judgement ? { decision: a.judgement.decision } : null,
      })),
      questionsUsed: tournament.tournamentQuestions.filter(tq => tq.isUsed).length,
      questionsTotal: tournament.tournamentQuestions.length,
    };
  }
}
