import React from 'react';
import PropTypes from 'prop-types';

/**
 * The static awards card (#1863, ADR 0052 amendment): the Team's called shot
 * result, Perfect Lineup and Captain Hindsight for the Matchup's week, in the
 * result card's style. Nothing on it moves and it has no audio.
 */
function AwardsCard({ item }) {
  return (
    <div className="postgame-card" data-testid="postgame-awards-card">
      <div className="postgame-league">{item.leagueName}</div>
      <div className="postgame-outcome">AWARDS</div>
      <ul className="postgame-awards">
        {item.awards.map((award) => (
          <li key={award.type} className="postgame-award">
            <span className="postgame-award-label">{award.label}</span>
            {award.detail && <span className="postgame-award-detail">{award.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

AwardsCard.propTypes = {
  item: PropTypes.shape({
    leagueName: PropTypes.string,
    awards: PropTypes.arrayOf(PropTypes.shape({
      type: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      detail: PropTypes.string,
    })).isRequired,
  }).isRequired,
};

export default AwardsCard;
