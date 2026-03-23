import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Track connected users: socketId -> { userId, role, nickname }
  private connectedUsers = new Map<string, { userId: string; role: string; nickname: string }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Connection handling ──────────────────────
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token
        || client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (token) {
        const payload = this.jwt.verify(token, {
          secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        });
        this.connectedUsers.set(client.id, {
          userId: payload.sub,
          role: payload.role,
          nickname: payload.email,
        });
        console.log(`🔌 WS connected: ${payload.email} (${client.id})`);
      } else {
        // Allow anonymous spectators
        this.connectedUsers.set(client.id, {
          userId: 'anonymous',
          role: 'guest',
          nickname: 'spectator',
        });
        console.log(`🔌 WS spectator connected: ${client.id}`);
      }
    } catch (err) {
      console.log(`🔌 WS auth failed: ${client.id}`);
      this.connectedUsers.set(client.id, {
        userId: 'anonymous',
        role: 'guest',
        nickname: 'spectator',
      });
    }
  }

  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    console.log(`🔌 WS disconnected: ${user?.nickname || client.id}`);
    this.connectedUsers.delete(client.id);
  }

  // ─── Join tournament room ─────────────────────
  @SubscribeMessage('join_tournament')
  handleJoinTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournamentId: string },
  ) {
    client.join(`tournament:${data.tournamentId}`);
    const user = this.connectedUsers.get(client.id);
    console.log(`📺 ${user?.nickname} joined tournament room: ${data.tournamentId}`);
    return { event: 'joined_tournament', data: { tournamentId: data.tournamentId } };
  }

  // ─── Leave tournament room ────────────────────
  @SubscribeMessage('leave_tournament')
  handleLeaveTournament(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournamentId: string },
  ) {
    client.leave(`tournament:${data.tournamentId}`);
    return { event: 'left_tournament', data: { tournamentId: data.tournamentId } };
  }

  // ─── Join admin room ──────────────────────────
  @SubscribeMessage('join_admin')
  handleJoinAdmin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tournamentId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (user && ['ADMIN', 'SUPERADMIN', 'JUDGE'].includes(user.role)) {
      client.join(`admin:${data.tournamentId}`);
      return { event: 'joined_admin', data: { tournamentId: data.tournamentId } };
    }
    return { event: 'error', data: { message: 'Not authorized' } };
  }

  // ─── Server → Client events (called from services) ──

  // Tournament started
  emitTournamentStarted(tournamentId: string, data: any) {
    this.server.to(`tournament:${tournamentId}`).emit('tournament_started', data);
  }

  // New question started
  emitQuestionStarted(tournamentId: string, data: {
    orderIndex: number;
    category: string;
    localizations: { language: string; questionText: string }[];
    timerSeconds: number;
  }) {
    this.server.to(`tournament:${tournamentId}`).emit('question_started', data);
  }

  // Timer tick (sent every second)
  emitTimerTick(tournamentId: string, secondsLeft: number) {
    this.server.to(`tournament:${tournamentId}`).emit('timer_tick', { secondsLeft });
  }

  // Question locked (time's up)
  emitQuestionLocked(tournamentId: string) {
    this.server.to(`tournament:${tournamentId}`).emit('question_locked', {});
  }

  // Judgement ready (for specific player)
  emitJudgementReady(tournamentId: string, data: {
    userId: string;
    answerId: string;
    decision: string;
    correctAnswer: string;
    scoreUser: number;
    scoreSystem: number;
    matchStatus: string;
  }) {
    // Send to tournament room (everyone sees score update)
    this.server.to(`tournament:${tournamentId}`).emit('score_updated', {
      userId: data.userId,
      scoreUser: data.scoreUser,
      scoreSystem: data.scoreSystem,
      matchStatus: data.matchStatus,
    });

    // Send detailed judgement to admin room
    this.server.to(`admin:${tournamentId}`).emit('judgement_made', data);
  }

  // New answer submitted (for admin)
  emitAnswerSubmitted(tournamentId: string, data: {
    answerId: string;
    userId: string;
    nickname: string;
    answerText: string;
  }) {
    this.server.to(`admin:${tournamentId}`).emit('answer_submitted', data);
  }

  // All answers submitted (for admin)
  emitAllAnswersSubmitted(tournamentId: string) {
    this.server.to(`admin:${tournamentId}`).emit('all_answers_submitted', {});
  }

  // Match finished for a player
  emitMatchFinished(tournamentId: string, data: {
    userId: string;
    matchStatus: string;
    finalScoreUser: number;
    finalScoreSystem: number;
  }) {
    this.server.to(`tournament:${tournamentId}`).emit('match_finished', data);
  }

  // Tournament finished
  emitTournamentFinished(tournamentId: string) {
    this.server.to(`tournament:${tournamentId}`).emit('tournament_finished', {});
  }

  // Reaction update
  emitReactionUpdated(tournamentId: string, questionId: string, reactions: any[]) {
    this.server.to(`tournament:${tournamentId}`).emit('reactions_updated', {
      questionId,
      reactions,
    });
  }

  // ─── Stats ────────────────────────────────────
  getOnlineCount(tournamentId?: string): number {
    if (tournamentId) {
      const room = this.server?.sockets?.adapter?.rooms?.get(`tournament:${tournamentId}`);
      return room?.size || 0;
    }
    return this.connectedUsers.size;
  }
}
