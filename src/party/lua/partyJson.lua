-- Redis cjson encodes an empty Lua array as {}, so serialize members separately.
local function encodeParty(party)
  local members = party.members
  party.members = nil
  local encoded = cjson.encode(party)
  party.members = members
  local encodedMembers = next(members) == nil and '[]' or cjson.encode(members)
  return string.sub(encoded, 1, -2) .. ',"members":' .. encodedMembers .. '}'
end

local function encodeState(party, now)
  return '{"party":' .. encodeParty(party) .. ',"serverTime":' .. cjson.encode(now) .. '}'
end

local function encodeStateEvent(party, now)
  return '{"partyId":' .. cjson.encode(party.id) .. ',"message":{"type":"state","party":' ..
    encodeParty(party) .. ',"serverTime":' .. cjson.encode(now) .. '}}'
end
