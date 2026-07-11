import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import apiClient from '../../api/apiClient';

const TYPE_COLORS = {
  add: 'success',
  drop: 'default',
  waiver: 'info',
  trade: 'warning',
  commissioner: 'secondary',
};

function describeTransaction(txn) {
  switch (txn.type) {
    case 'add':
      return `added ${txn.player_name}`;
    case 'drop':
      return `dropped ${txn.player_name}`;
    case 'waiver': {
      const bidSuffix = typeof txn.detail?.bid === 'number' ? ` ($${txn.detail.bid})` : '';
      return `claimed ${txn.player_name}${bidSuffix}`;
    }
    case 'trade':
      return 'completed a trade';
    case 'commissioner':
      return 'commissioner action';
    default:
      return '';
  }
}

function TransactionLog() {
  const { leagueId } = useParams();
  const [transactions, setTransactions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/transactions`);
      setTransactions(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !transactions) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Typography variant="h4" sx={{ mb: 3 }}>
        League Activity
      </Typography>

      {transactions &&
        (transactions.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>No activity yet</Typography>
        ) : (
          <Paper sx={{ p: 2 }}>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell>Description</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell>{new Date(txn.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={txn.type}
                          size="small"
                          color={TYPE_COLORS[txn.type] || 'default'}
                        />
                      </TableCell>
                      <TableCell>{txn.team_name}</TableCell>
                      <TableCell>{describeTransaction(txn)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        ))}
    </Container>
  );
}

export default TransactionLog;
