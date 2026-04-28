import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*', credentials: true }, namespace: '/' })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private connectedUsers = new Map<string, { userId: string; role: string; nickname: string }>();
  // Game state per tournament for reconnect
  private gameStates = new Map<string, any>();

  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        const payload = this.jwt.verify(token, { secret: this.config.get<string>('JWT_ACCESS_SECRET') });
        this.connectedUsers.set(client.id, { userId: payload.sub, role: payload.role, nickname: payload.email });
        client.join('dashboard');
      } else {
        this.connectedUsers.set(client.id, { userId: 'anonymous', role: 'guest', nickname: 'spectator' });
        client.join('dashboard');
      }
    } catch {
      this.connectedUsers.set(client.id, { userId: 'anonymous', role: 'guest', nickname: 'spectator' });
      client.join('dashboard');
    }
  }

  handleDisconnect(client: Socket) { this.connectedUsers.delete(client.id); }

  @SubscribeMessage('join_tournament')
  handleJoinTournament(@ConnectedSocket() client: Socket, @MessageBody() data: { tournamentId: string }) {
    client.join(`tournament:${data.tournamentId}`);
    // Send current game state for reconnect
    const state = this.gameStates.get(data.tournamentId);
    if (state) {
      const now = Date.now();
      let phase = state.phase;
      let timerSeconds = 0;

      if (now < state.readingEndsAt) {
        phase = 'reading';
        timerSeconds = 0;
      } else if (now < state.answeringEndsAt) {
        phase = 'answering';
        timerSeconds = Math.ceil((state.answeringEndsAt - now) / 1000);
      } else {
        phase = 'locked';
      }

      client.emit('game_state_restore', {
        questionId: state.questionId,
        orderIndex: state.orderIndex,
        localizations: state.localizations,
        phase,
        timerSeconds,
      });
    }
    return { event: 'joined_tournament', data: { tournamentId: data.tournamentId } };
  }

  @SubscribeMessage('leave_tournament')
  handleLeaveTournament(@ConnectedSocket() client: Socket, @MessageBody() data: { tournamentId: string }) {
    client.leave(`tournament:${data.tournamentId}`);
    return { event: 'left_tournament', data: { tournamentId: data.tournamentId } };
  }

  @SubscribeMessage('join_admin')
  handleJoinAdmin(@ConnectedSocket() client: Socket, @MessageBody() data: { tournamentId: string }) {
    const user = this.connectedUsers.get(client.id);
    if (user && ['ADMIN', 'SUPERADMIN', 'JUDGE'].includes(user.role)) {
      client.join(`admin:${data.tournamentId}`);
      return { event: 'joined_admin', data: { tournamentId: data.tournamentId } };
    }
    return { event: 'error', data: { message: 'Not authorized' } };
  }

  // Game state management
  setGameState(tournamentId: string, state: any) { this.gameStates.set(tournamentId, state); }
  clearGameState(tournamentId: string) { this.gameStates.delete(tournamentId); }
  setGamePhase(tournamentId: string, phase: string) {
    const s = this.gameStates.get(tournamentId);
    if (s) { s.phase = phase; this.gameStates.set(tournamentId, s); }
  }
  getGameState(tournamentId: string) { return this.gameStates.get(tournamentId) || null; }

  // Emitters
  emitGlobal(event: string, data: any) { this.server.to('dashboard').emit(event, data); }
  emitTournamentStarted(tid: string, data: any) { this.server.to(`tournament:${tid}`).emit('tournament_started', data); }
  emitTournamentFinished(tid: string) { this.server.to(`tournament:${tid}`).emit('tournament_finished', {}); }
  emitQuestionStarted(tid: string, data: any) { this.server.to(`tournament:${tid}`).emit('question_started', data); }
  emitTimerTick(tid: string, sec: number, phase: string) { this.server.to(`tournament:${tid}`).emit('timer_tick', { secondsLeft: sec, phase }); }
  emitPhaseChanged(tid: string, phase: string, sec: number) { this.server.to(`tournament:${tid}`).emit('phase_changed', { phase, seconds: sec }); }
  emitQuestionLocked(tid: string) { this.server.to(`tournament:${tid}`).emit('question_locked', {}); }
  emitJudgementReady(tid: string, data: any) {
    this.server.to(`tournament:${tid}`).emit('score_updated', { userId: data.userId, scoreUser: data.scoreUser, scoreSystem: data.scoreSystem, matchStatus: data.matchStatus });
    this.server.to(`tournament:${tid}`).emit('judgement_made', data);
    this.server.to(`admin:${tid}`).emit('judgement_made', data);
  }
  emitAnswerSubmitted(tid: string, data: any) { this.server.to(`admin:${tid}`).emit('answer_submitted', data); }
  emitAllAnswersSubmitted(tid: string) { this.server.to(`admin:${tid}`).emit('all_answers_submitted', {}); }
  emitMatchFinished(tid: string, data: any) { this.server.to(`tournament:${tid}`).emit('match_finished', data); }
  emitReactionUpdated(tid: string, qid: string, reactions: any[]) { this.server.to(`tournament:${tid}`).emit('reactions_updated', { questionId: qid, reactions }); }

  getOnlineCount(tid?: string): number {
    if (tid) { const r = this.server?.sockets?.adapter?.rooms?.get(`tournament:${tid}`); return r?.size || 0; }
    return this.connectedUsers.size;
  }
}
