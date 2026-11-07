-- End the party and remove its live presence and lookup entries atomically.
local stateKey = KEYS[1]
local hostKey = KEYS[2]
local usernameKey = KEYS[3]
local activePartiesKey = KEYS[4]
local presenceKey = KEYS[5]
local peopleKey = KEYS[6]
local eventsChannel = KEYS[7]

local hostId = ARGV[1]          -- Empty bypasses the host check
local reason = ARGV[2]

local raw = redis.call('GET', stateKey)
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
if hostId ~= '' and party.host.id ~= hostId then return cjson.encode({error='forbidden'}) end
redis.call('PUBLISH', eventsChannel, cjson.encode({partyId=party.id, message={type='ended', reason=reason}}))
-- Avoid deleting a lookup that has already been reassigned to another party.
if redis.call('GET', hostKey) == party.id then redis.call('DEL', hostKey) end
if redis.call('GET', usernameKey) == party.id then redis.call('DEL', usernameKey) end
redis.call('SREM', activePartiesKey, party.id)
redis.call('DEL', stateKey, presenceKey, peopleKey)
return cjson.encode({party=party})
