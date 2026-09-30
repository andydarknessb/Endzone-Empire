import React from 'react';
import PropTypes from 'prop-types';
import { Sprite, TeamAvatar } from '../../../shared/ui';
import { OUTCOME_WORD, recordLine } from '../model/plan';
import { kitForTeam } from '../model/teamKit';

function Side({ side, kit, testId }) {
  return (
    <div className="postgame-side" data-testid={testId}>
      <TeamAvatar name={side.name || ''} avatarUrl={side.avatarStaticUrl} avatarStaticUrl={side.avatarStaticUrl} size={48} />
      <Sprite kit={kit} frame={0} className="postgame-sprite" />
      <span className="postgame-team">{side.name || 'TEAM'}</span>
      <span className="postgame-score">{side.score}</span>
    </div>
  );
}

Side.propTypes = {
  side: PropTypes.shape({
    name: PropTypes.string,
    avatarStaticUrl: PropTypes.string,
    score: PropTypes.number,
  }).isRequired,
  kit: PropTypes.object.isRequired,
  testId: PropTypes.string.isRequired,
};

/**
 * The static result card: the one scene every outcome gets until the WIN, LOSS
 * and TIE scenes replace it, and the only scene under reduced motion. Nothing on
 * it moves. On a loss it carries the one link, to the league's Waiver wire;
 * `onLeave` runs when it is followed so the queue ends behind the navigation.
 */
function ResultCard({ item, onLeave }) {
  const oppKit = kitForTeam(item.opponent.teamId);
  const myKit = kitForTeam(item.me.teamId, oppKit);
  const line = recordLine(item);
  return (
    <div className="postgame-card" data-testid="postgame-result-card" data-outcome={item.outcome}>
      <div className="postgame-league">{item.leagueName}</div>
      <div className="postgame-outcome">{OUTCOME_WORD[item.outcome] || OUTCOME_WORD.tie}</div>
      <div className="postgame-sides">
        <Side side={item.me} kit={myKit} testId="postgame-side-me" />
        <span className="postgame-vs" aria-hidden="true">VS</span>
        <Side side={item.opponent} kit={oppKit} testId="postgame-side-opponent" />
      </div>
      {line && <div className="postgame-record">{line}</div>}
      {item.outcome === 'loss' && (
        <a
          className="postgame-link"
          href={`#/league/${item.leagueId}/waivers`}
          onClick={onLeave}
        >
          RETREAT TO THE WAIVER WIRE
        </a>
      )}
    </div>
  );
}

ResultCard.propTypes = {
  item: PropTypes.shape({
    leagueId: PropTypes.number,
    leagueName: PropTypes.string,
    playoff: PropTypes.bool,
    outcome: PropTypes.string,
    me: PropTypes.object,
    opponent: PropTypes.object,
    record: PropTypes.object,
    standing: PropTypes.object,
  }).isRequired,
  onLeave: PropTypes.func,
};

export default ResultCard;
