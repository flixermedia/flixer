-- Atomically validate, store, and broadcast a party chat message.
local stateKey = KEYS[1]
local peopleKey = KEYS[2]       -- Connection ID -> serialized person
local rateLimitKey = KEYS[3]    -- Per-user message counter
local chatHistoryKey = KEYS[4]
local eventsChannel = KEYS[5]

local senderId = ARGV[1]
local messageJson = ARGV[2]
local partyId = ARGV[3]
local historyLimit = ARGV[4]
local partyTtlSeconds = ARGV[5]

local raw = redis.call('GET', stateKey)
if not raw then return cjson.encode({error='missing'}) end

-- Only connected members may send chat messages.
local isMember = false
for _, value in ipairs(redis.call('HVALS', peopleKey)) do
  if cjson.decode(value).id == senderId then isMember = true; break end
end
if not isMember then return cjson.encode({error='not-member'}) end

-- Allow up to five messages per five-second window.
local count = redis.call('INCR', rateLimitKey)
if count == 1 then redis.call('EXPIRE', rateLimitKey, 5) end
if count > 5 then return cjson.encode({error='rate-limited'}) end

-- Redis time gives all API instances the same message timestamp.
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local message = cjson.decode(messageJson)
message.at = now
local encoded = cjson.encode(message)
redis.call('LPUSH', chatHistoryKey, encoded)
redis.call('LTRIM', chatHistoryKey, 0, tonumber(historyLimit) - 1)
redis.call('EXPIRE', chatHistoryKey, tonumber(partyTtlSeconds))
redis.call('PUBLISH', eventsChannel, cjson.encode({partyId=partyId, message={type='chat', message=message}}))
return encoded
