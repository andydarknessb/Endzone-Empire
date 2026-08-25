import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Box,
} from '@mui/material';
import apiClient from '../../api/apiClient';

export const GRADE_COLORS = {
  A: '#2e7d32', // green
  B: '#8bc34a', // light green
  C: '#ffb300', // amber
  D: '#fb8c00', // orange
  F: '#d32f2f', // red
};

function DraftGradesCard({ leagueId }) {
  const [payload, setPayload] = useState(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchGrades = async () => {
      try {
        const res = await apiClient.get(`/api/league/${leagueId}/draft-grades`);
        if (!cancelled) {
          setPayload(res.data);
          setHidden(false);
        }
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setHidden(true);
        }
      }
    };

    fetchGrades();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (hidden || !payload) {
    return null;
  }

  const grades = Array.isArray(payload.grades) ? payload.grades : [];

  return (
    <Paper sx={{ p: 2, mb: 3 }} data-testid="draft-grades-card">
      <Typography id="draft-grades-table-heading" variant="h6" sx={{ mb: 2 }}>
        Draft Grades
      </Typography>
      <TableContainer>
        <Table size="small" aria-labelledby="draft-grades-table-heading">
          <TableHead>
            <TableRow>
              <TableCell>Rank</TableCell>
              <TableCell>Team</TableCell>
              <TableCell align="center">Grade</TableCell>
              <TableCell align="right">Roster Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {grades.map((row) => (
              <TableRow key={row.teamId} data-testid={`draft-grade-row-${row.teamId}`}>
                <TableCell>{row.rank}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell align="center">
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      color: 'common.white',
                      bgcolor: GRADE_COLORS[row.grade] || 'grey.500',
                      fontWeight: 'bold',
                    }}
                  >
                    {row.grade}
                  </Box>
                </TableCell>
                <TableCell align="right">{row.rosterValue}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default DraftGradesCard;
