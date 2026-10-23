import React from 'react';
import { Box } from '@mui/material';
import { Tag } from '../../shared/ui/playselect/Marks';
import { ROSTER_POSITION_OPTIONS } from '../../lib/leagueRulesFormat';
import {
  Dim, RulesTable, SectionTitle, TagRow,
} from './rulesParts';

export default function RosterRulesView({ league }) {
  const slots = league.roster_slots || [];
  const benchSlots = Number(league.bench_slots) || 0;
  const irSlots = Number(league.ir_slots) || 0;
  const starters = slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const totalRosterSize = starters + benchSlots + irSlots;
  // The drafted spots are starters + bench; the IR slot costs no draft round
  // (#96). A league with no IR slot reads exactly as it did before.
  const draftSpots = starters + benchSlots;
  const caps = league.position_caps || {};
  const cappedPositions = ROSTER_POSITION_OPTIONS.filter((p) => caps[p] !== undefined && caps[p] !== null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <Box>
        <TagRow sx={{ mb: '16px' }}>
          <Tag>{`${starters} starters`}</Tag>
          <Tag>{`${benchSlots} bench`}</Tag>
          <Tag>{`${irSlots} IR`}</Tag>
          <Tag>
            {irSlots > 0
              ? `${draftSpots} roster spots + up to ${irSlots} IR`
              : `${totalRosterSize} total roster spots`}
          </Tag>
          {league.dp_enabled && <Tag>IDP enabled</Tag>}
        </TagRow>
        {slots.length === 0 ? (
          <Dim>No starting lineup slots have been configured yet.</Dim>
        ) : (
          <RulesTable label="Starting lineup slots" sx={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Slot</th>
                <th className="num">Count</th>
                <th>Eligible positions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.key}>
                  <td>{slot.label || slot.key}</td>
                  <td className="num">{Number(slot.count) || 0}</td>
                  <td>{(slot.eligiblePositions || []).join(', ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </RulesTable>
        )}
      </Box>

      <Box>
        <SectionTitle>Draft position limits</SectionTitle>
        {cappedPositions.length === 0 ? (
          <Dim>No position limits. You can draft any mix of positions.</Dim>
        ) : (
          <>
            <Dim sx={{ mb: '12px' }}>Limits apply only while drafting; rosters can change freely afterward.</Dim>
            <TagRow>
              {cappedPositions.map((p) => (
                <Tag key={p}>{`${p}: max ${caps[p]}`}</Tag>
              ))}
            </TagRow>
          </>
        )}
      </Box>
    </Box>
  );
}
