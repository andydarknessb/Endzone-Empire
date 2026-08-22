const persistedEvents = [];
const mockSupabaseUpsert = jest.fn(async (event) => {
  persistedEvents.push(event);
  return { data: null, error: null };
});
const mockSupabaseFrom = jest.fn(() => ({ upsert: mockSupabaseUpsert }));
const mockSupabaseClient = { from: mockSupabaseFrom };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

const { createClient } = require('@supabase/supabase-js');
const fixture = require('./fixtures/tank01-chaotic-live-feed.json');
const {
  ingestTank01Events,
} = require('../../server/services/tank01EventIngestion.service');

describe('chaotic Tank01 live-feed ingestion', () => {
  let fetchSpy;
  let ingestion;

  beforeAll(async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network isolation violation: global fetch was called')
    );
    const supabase = createClient('https://supabase.test.invalid', 'test-only-key');
    const writeEvent = async (event) => {
      const { error } = await supabase
        .from('live_player_event_stats')
        .upsert(event, { onConflict: 'eventId' });
      if (error) throw error;
    };

    ingestion = await ingestTank01Events(fixture.events, { writeEvent });
  });

  afterAll(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('processes the entire feed while safely coercing invalid passing yards', () => {
    const corrupted = ingestion.processedEvents.find(({ eventId }) => eventId === 'evt-0801');

    expect(ingestion.received).toBe(1000);
    expect(ingestion.processed).toBe(998);
    expect(corrupted.normalizedStats.passingYards).toBe(0);
    expect(Number.isFinite(corrupted.passingPoints)).toBe(true);
  });

  test('drops the three-event touchdown replay after applying it exactly once', () => {
    const touchdownUpdates = ingestion.processedEvents.filter(({ eventId }) => eventId === 'evt-0101');
    const persistedTouchdowns = persistedEvents.filter(({ eventId }) => eventId === 'evt-0101');

    expect(ingestion.duplicatesDropped).toBe(2);
    expect(touchdownUpdates).toHaveLength(1);
    expect(touchdownUpdates[0].passingPoints).toBe(5.68);
    expect(persistedTouchdowns).toHaveLength(1);
  });

  test('orders the Q4 correction and Q2 block by tracking sequence, not timestamp', async () => {
    const q4Correction = fixture.events[500];
    const q2Drive = fixture.events[501];
    const reordered = await ingestTank01Events([q2Drive, q4Correction]);

    expect(new Date(q4Correction.received_at).getTime()).toBeGreaterThan(
      new Date(q2Drive.received_at).getTime()
    );
    expect(reordered.processedEvents.map(({ sequence }) => sequence)).toEqual([501, 502]);
    expect(reordered.latestSequenceByGame['20260111-KC-BUF']).toBe(502);
  });

  test.each([
    ['evt-0701', 'qb-SF'],
    ['evt-0702', 'qb-SF'],
  ])('credits passer points when %s has a null or missing receiver', (eventId, passerId) => {
    const event = ingestion.processedEvents.find((candidate) => candidate.eventId === eventId);

    expect(event.receiverId).toBeNull();
    expect(event.passerId).toBe(passerId);
    expect(event.passingPoints).toBe(5.68);
  });

  test('keeps every Supabase write hermetic and mocked', () => {
    expect(jest.isMockFunction(createClient)).toBe(true);
    expect(jest.isMockFunction(mockSupabaseFrom)).toBe(true);
    expect(jest.isMockFunction(mockSupabaseUpsert)).toBe(true);
    expect(persistedEvents).toHaveLength(998);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
