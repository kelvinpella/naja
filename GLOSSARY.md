# Naja

Naja is a WhatsApp marketplace connecting Tanzanian households with trusted domestic workers. This glossary records the language used for the conversation the agent has with each person.

## Language

**Person**:
Someone who messages Naja on WhatsApp, identified by their business-scoped user id when present, otherwise by phone number.
_Avoid_: user, contact, customer, sender

**Conversation**:
Everything a Person and Naja have said to each other, continuing across days, numbers, and separate sittings.
_Avoid_: session, chat, dialogue, history

**Thread**:
The stored record that holds a Conversation; each Person has exactly one.
_Avoid_: channel, room, context

**Turn**:
One inbound message together with the single reply it produces.
_Avoid_: exchange, round, interaction

**Memory**:
What Naja carries into a Turn: the recent messages of the Thread and any Observations covering older ones.
_Avoid_: context window, history buffer, state

**Observation**:
A short note that compresses what happened in older parts of a Conversation, so the Thread can keep growing without dragging every message along.
_Avoid_: summary, embedding, recollection

**Media message**:
An inbound message that carries no text: an image, voice note, document, sticker, or location.
_Avoid_: attachment, file, media type

**Job**:
A piece of work a household wants done, with a title, description, area, budget, optional image, and skills. Jobs are not yet part of the Conversation.
_Avoid_: gig, posting, listing

**Domestic worker**:
A person who provides household work through Naja: house helps, cooks, gardeners, drivers, cleaners, security guards, and fundis.
_Avoid_: helper, employee, candidate, applicant
