import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Container, Paper, Typography, TextField, Button, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/auth/forgot-password', { email: email.trim() });
      setNotice(res.data.message || 'If that email exists, a reset link has been sent.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Forgot Password
        </Typography>
        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <form onSubmit={handleSubmit}>
          <TextField
            id="forgot-email"
            label="Email"
            type="email"
            fullWidth
            margin="normal"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!email.trim() || submitting}
            sx={{ mt: 2 }}
          >
            Send Reset Link
          </Button>
        </form>
        <Typography variant="body2" sx={{ mt: 2 }}>
          <Link to="/login">Back to login</Link>
        </Typography>
      </Paper>
    </Container>
  );
}

export default ForgotPassword;
