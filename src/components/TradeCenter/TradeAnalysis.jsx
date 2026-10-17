import React, { useCallback, useRef, useState } from 'react';
import { Box } from '@mui/material';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { formatPoints } from '../../shared/lib/numeric';
import { PixelArrow } from '../../shared/ui/playselect/Icons';
import { PsLinkButton } from '../../shared/ui/playselect/Controls';
import { PosTag, StatusChip } from '../../shared/ui/playselect/Marks';
import { SR_ONLY_SX } from '../../shared/ui/playselect/type';
import TradeAlert from './TradeAlert';

const VERDICT_LABEL = {
  fair: 'Fair',
  favors_proposer: 'Favors Proposer',
  favors_receiver: 'Favors Receiver',
  collusion_risk: 'Collusion risk',
};

/**
 * One analysis request, owned by whoever shows it: POST /api/trades/analyze. A card sends `{ tradeId }`
 * (the server analyzes that trade's own items as its own two teams); the compose and counter dialogs send
 * the offered and requested ids, the viewer being the proposer.
 */
export function useTradeAnalysis(leagueId) {
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  // Only the latest request may write: a slower, older answer is for a selection that has since changed.
  const latest = useRef(0);

  const run = useCallback(async (body) => {
    latest.current += 1;
    const mine = latest.current;
    try {
      setAnalyzing(true);
      setError(null);
      const res = await apiClient.post('/api/trades/analyze', { leagueId: Number(leagueId), ...body });
      if (mine === latest.current) setResult(res.data);
    } catch (err) {
      if (mine === latest.current) setError(readHttpFailure(err).message || err.message);
    } finally {
      if (mine === latest.current) setAnalyzing(false);
    }
  }, [leagueId]);

  // The selection changed: the old answer (and any request still out) no longer describes it.
  const reset = useCallback(() => {
    latest.current += 1;
    setResult(null);
    setError(null);
    setAnalyzing(false);
  }, []);

  return { result, analyzing, error, run, reset };
}

/** The failure, or nothing. */
export function AnalysisError({ error }) {
  return error ? <TradeAlert>{error}</TradeAlert> : null;
}

const FIGURES = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** The verdict chip, the proposer's and receiver's gives and gets, and each player's value before and after roster fit. */
export function AnalysisResult({ result, onOpenPlayer }) {
  const line = (who, gives, gets) => (
    <Box sx={{ fontSize: '15px' }}>
      <Box component="b" sx={{ fontWeight: 600 }}>{`${who}:`}</Box>
      {` gives ${formatPoints(gives)} · gets ${formatPoints(gets)}`}
    </Box>
  );
  const players = result.players || [];
  return (
    <Box data-testid="trade-analysis" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box><StatusChip>{VERDICT_LABEL[result.verdict] || result.verdict}</StatusChip></Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4px 24px' }}>
        {line('Proposer', result.proposerGives, result.proposerGets)}
        {line('Receiver', result.receiverGives, result.receiverGets)}
      </Box>
      {players.length > 0 && (
        <Box component="ul" aria-label="Player values" sx={{ listStyle: 'none', m: 0, p: 0, borderTop: '2px solid var(--ps-rule)' }}>
          {players.map((p, i) => (
            <Box
              component="li"
              key={p.playerId}
              sx={{
                display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', borderBottom: i < players.length - 1 ? '2px solid var(--ps-rule)' : 0,
              }}
            >
              <PosTag position={p.position} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <PsLinkButton onClick={() => onOpenPlayer(p.playerId)}>{p.name}</PsLinkButton>
              </Box>
              <Box
                component="span"
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '15px', ...FIGURES,
                }}
              >
                <Box component="span" sx={SR_ONLY_SX}>
                  {`rest-of-season value ${formatPoints(p.rosValue)}, adjusted for roster fit ${formatPoints(p.fitAdjustedValue)}`}
                </Box>
                <span aria-hidden="true">{formatPoints(p.rosValue)}</span>
                <PixelArrow />
                <Box component="b" aria-hidden="true" sx={{ fontWeight: 700 }}>{formatPoints(p.fitAdjustedValue)}</Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
