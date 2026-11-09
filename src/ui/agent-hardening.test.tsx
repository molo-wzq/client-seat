import { act, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DeskPet } from './DeskPet';
import type { AgentClient } from './agent-client';
import type { AgentEvent } from '../shared/agent-contract';
import { settleHiddenCards } from './HiddenCards';
import type { ConversationTurn } from '../domain/types';

it('spec story 3: incoming channel must stay silent during a call', async () => {
  let listener: (event: AgentEvent) => void = () => {};
  const agent: AgentClient = {
    async sendCommand() {},
    async sendTrigger() { return {triggerId:'t',admitted:true,ticket:null,report:null}; },
    onEvent(next) { listener=next; return () => {}; },
    async tickets() { return []; },
    async policy() { return {version:1,acceptMode:'observe',rules:[]}; },
    async setAcceptMode(mode) { return {version:2,acceptMode:mode,rules:[]}; },
    async evals() { return []; },
    async sendChat() {},
  };
  render(<DeskPet inCall agent={agent} />);
  await act(async () => {
    listener({type:'channel',channel:{target:'pet-bubble',ticketId:'background',text:'后台工作完成'}});
  });
  expect(screen.queryByLabelText('桌宠气泡')).not.toBeInTheDocument();
});

it('spec story 6: unanswered raised card is an edge signal at settlement', () => {
  const turns: ConversationTurn[] = [{number:1,speaker:'manager',text:'季度奖金到账了吗？'}];
  expect(settleHiddenCards(['季度奖金即将到账'],turns,[],{})[0].miss).toBe('edge');
});

it('existing bubble is hidden when entering a call', async () => {
  let listener: (event: AgentEvent) => void = () => {};
  const agent: AgentClient = {
    async sendCommand() {},
    async sendTrigger() { return {triggerId:'t',admitted:true,ticket:null,report:null}; },
    tickets: async () => [],
    onEvent(next: (event: AgentEvent) => void) { listener = next; return () => {}; },
    async policy() { return {version:1,acceptMode:'observe',rules:[]}; },
    async setAcceptMode(mode) { return {version:2,acceptMode:mode,rules:[]}; },
    async evals() { return []; },
    async sendChat() {},
  };
  const { rerender } = render(<DeskPet agent={agent} />);
  await act(async () => {
    listener({type:'channel',channel:{target:'pet-bubble',ticketId:'old',text:'上一条回复'}});
  });
  expect(screen.getByLabelText('桌宠气泡')).toBeInTheDocument();
  rerender(<DeskPet agent={agent} inCall />);
  expect(screen.queryByLabelText('桌宠气泡')).not.toBeInTheDocument();
});
