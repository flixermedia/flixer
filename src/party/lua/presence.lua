-- Update connection presence and rebuild the unique party member list.
local stateKey = KEYS[1]
local presenceKey = KEYS[2]     -- Connection ID -> expiry time in milliseconds
local peopleKey = KEYS[3]       -- Connection ID -> serialized person
local eventsChannel = KEYS[4]

local action = ARGV[1]          -- join, leave, or renew
local connectionId = ARGV[2]
local personId = ARGV[3]
local presenceTtlMs = ARGV[4]
local maxMembers = ARGV[5]
local personJson = ARGV[6]
local requestedAction = ARGV[7] -- Distinguishes a sweep from a normal renewal
local partyTtlSeconds = ARGV[8]

local raw = redis.call('GET', stateKey)
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
-- Drop expired connections and their associated person records first.
redis.call('ZREMRANGEBYSCORE', presenceKey, '-inf', now)
for _, id in ipairs(redis.call('HKEYS', peopleKey)) do
  if not redis.call('ZSCORE', presenceKey, id) then redis.call('HDEL', peopleKey, id) end
end

-- Limit distinct people, not connections, so multiple tabs count once.
if action == 'join' then
  local unique = {}
  for _, id in ipairs(redis.call('ZRANGE', presenceKey, 0, -1)) do
    local value = redis.call('HGET', peopleKey, id)
    if value then unique[cjson.decode(value).id] = true end
  end
  if not unique[personId] then
    local count = 0
    for _ in pairs(unique) do count = count + 1 end
    if count >= tonumber(maxMembers) then return cjson.encode({error='full'}) end
  end
  redis.call('ZADD', presenceKey, now + tonumber(presenceTtlMs), connectionId)
  redis.call('HSET', peopleKey, connectionId, personJson)
elseif action == 'leave' then
  redis.call('ZREM', presenceKey, connectionId)
  redis.call('HDEL', peopleKey, connectionId)
elseif action == 'renew' then
  if redis.call('ZSCORE', presenceKey, connectionId) then
    redis.call('ZADD', presenceKey, now + tonumber(presenceTtlMs), connectionId)
  end
end
-- Rebuild the public member list from the remaining live connections.
local members = cjson.decode('[]')
local seen = {}
for _, id in ipairs(redis.call('ZRANGE', presenceKey, 0, -1)) do
  local value = redis.call('HGET', peopleKey, id)
  if value then
    local person = cjson.decode(value)
    if not seen[person.id] then
      seen[person.id] = true
      table.insert(members, person)
    end
  end
end
party.members = members
redis.call('SET', stateKey, cjson.encode(party), 'EX', tonumber(partyTtlSeconds))
redis.call('EXPIRE', presenceKey, tonumber(partyTtlSeconds))
redis.call('EXPIRE', peopleKey, tonumber(partyTtlSeconds))
local message = {type='state', party=party, serverTime=now}
-- Normal heartbeats stay quiet; joins, leaves, and sweeps broadcast state.
if action ~= 'renew' then
  redis.call('PUBLISH', eventsChannel, cjson.encode({partyId=party.id, message=message}))
elseif requestedAction == 'sweep' then
  redis.call('PUBLISH', eventsChannel, cjson.encode({partyId=party.id, message=message}))
end
return cjson.encode({party=party, serverTime=now})
