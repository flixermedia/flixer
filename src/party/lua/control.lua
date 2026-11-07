-- Atomically apply a host playback command and broadcast the new timeline.
local stateKey = KEYS[1]
local rateLimitKey = KEYS[2]
local eventsChannel = KEYS[3]

local hostId = ARGV[1]
local commandJson = ARGV[2]
local leadMs = ARGV[3]
local itemJson = ARGV[4]       -- Empty when the item is unchanged
local maxPositionSeconds = ARGV[5]
local partyTtlSeconds = ARGV[6]

local raw = redis.call('GET', stateKey)
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
if party.host.id ~= hostId then return cjson.encode({error='forbidden'}) end
local command = cjson.decode(commandJson)

-- Retried command IDs are idempotent and do not consume the rate limit.
if party.lastCommandId == command.commandId then
  local time = redis.call('TIME')
  return cjson.encode({party=party, serverTime=(tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)})
end
local count = redis.call('INCR', rateLimitKey)
if count == 1 then redis.call('EXPIRE', rateLimitKey, 5) end
if count > 30 then return cjson.encode({error='control-rate-limited'}) end

-- Advance the current position to Redis time before applying the command.
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local delay = tonumber(leadMs)
local rate = tonumber(party.playbackRate) or 1
local position = tonumber(party.position) or 0
if party.playing then position = position + math.max(0, now - (tonumber(party.at) or now)) * rate / 1000 end
local itemChanged = false
if itemJson ~= '' then
  local item = cjson.decode(itemJson)
  if ((item.type == 'track') ~= (party.kind == 'music')) then
    return cjson.encode({error='kind-mismatch'})
  end
  if item.id ~= party.item.id then
    party.item = item
    position = 0
    itemChanged = true
  end
end
-- The lead time lets clients schedule the new state together.
if command.action == 'play' then
  if party.playing then position = position + delay * rate / 1000 end
  party.playing = true
elseif command.action == 'pause' then
  if party.playing then position = position + delay * rate / 1000 end
  party.playing = false
elseif command.action == 'seek' then
  if not itemChanged then
    position = math.max(0, math.min(tonumber(command.position) or 0, tonumber(maxPositionSeconds)))
  end
elseif command.action ~= 'change-item' then
  return cjson.encode({error='invalid-command'})
end
party.position = position
party.at = now + delay
party.version = (tonumber(party.version) or 0) + 1
party.lastCommandId = command.commandId
redis.call('SET', stateKey, cjson.encode(party), 'EX', tonumber(partyTtlSeconds))
local message = {type='state', party=party, serverTime=now}
redis.call('PUBLISH', eventsChannel, cjson.encode({partyId=party.id, message=message}))
return cjson.encode({party=party, serverTime=now})
