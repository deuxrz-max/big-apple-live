import { BotActivityLine } from '../../src/chat/BotActivityLine';
import { ShinyName } from '../../src/components/ShinyName';
import { BadgeMark } from '../../src/social/common';

export function RoomFeedFixture() {
  return <section style={{ width: '100%', maxWidth: 390, margin: '0 auto', background: '#000' }}>
    <div className="ch ur" style={{ height: 'auto', minHeight: 0 }}><div className="ch-msgs" style={{ overflow: 'visible' }}>
      {[
        ['wolf', 'Wolf Bot', 'heads out on patrol.'],
        ['ghost', 'Ghost Bot', 'slips quietly away.'],
        ['zombie', 'Zombie Bot', 'shuffles quietly away.'],
        ['vampire', 'Vampire Bot', 'has arrived'],
        ['wolf', 'Wolf Bot', 'keeps an eye on the room and welcomes everyone to a friendly conversation.'],
      ].map(([botId, name, body], i) => <div className="ch-msg" data-testid={`fixture-bot-${i}`} key={i}>
        <div><BotActivityLine botId={botId!} name={name!} body={body!} arrived={i === 3} chatter={i === 4} /></div>
      </div>)}
      {[1, 96, 100].map(level => <div className="ch-msg ur-arrival-line" key={level}>
        <div><BadgeMark id="monthly-tier-1" size={16} compact /><ShinyName displayNameTierIndex={level}>Room member</ShinyName> has arrived</div>
      </div>)}
    </div></div>
    <p className="st-live-chat-line" data-testid="fixture-live">
      <span className="st-live-chat-author"><ShinyName displayNameTierIndex={96}>Live viewer</ShinyName></span>
      Hello from the broadcast.
    </p>
  </section>;
}
