// The AI that answers first in the Support chat. Its messages are team-side messages in the thread under this name, which the chat and
// the Support Console use to label them "AI". Kept equal to the server's name (api/_lib/supportChat.js) by tests/supportChat.test.js.
export const SUPPORT_ASSISTANT_NAME = 'IcanEra Assistant';

export const isAssistantMessage = (message) => message?.sender_role === 'dev' && message?.sender_name === SUPPORT_ASSISTANT_NAME;
