-- B57: when gold is handed over, the sender weighs ALL the chosen pieces together and enters the scaled top and down.
-- The scale's figures are recorded beside what the books say (declared_top / declared_down). A difference is always
-- recorded, never refused; it is graded so it can be seen, and a big one tells the reviewers.
--
-- Grades (difference = scale - books, in grams):
--   top   : 0 ok · up to 0.10 notice (yellow) · up to 0.50 alert (orange) · over 0.50 critical (red)
--   down  : allowance = least(0.50, 0.02 + 0.01 x pieces + 0.001 x top weight)
--           up to half the allowance ok · up to the allowance notice · over it alert · over 0.50 critical
alter table gold.transfers add column scaled_top numeric(14,4) check (scaled_top >= 0);
alter table gold.transfers add column scaled_down numeric(14,4) check (scaled_down >= 0);
alter table gold.transfers add column scaled_level text check (scaled_level in ('ok', 'notice', 'alert', 'critical'));
alter table gold.transfers add constraint transfers_scaled_together check ((scaled_top is null) = (scaled_down is null));

create function gold.scale_level_rank(p text) returns int language sql immutable as $$
  select case p when 'critical' then 3 when 'alert' then 2 when 'notice' then 1 else 0 end
$$;

-- The grading, in one place. Used when releasing and when showing a transfer.
create function gold.scale_check(p_top_diff numeric, p_down_diff numeric, p_books_top numeric, p_pieces int) returns jsonb language plpgsql immutable as $$
declare
  v_allow numeric := least(0.5, 0.02 + 0.01 * greatest(p_pieces, 0) + 0.001 * greatest(p_books_top, 0));
  a_top numeric := abs(p_top_diff); a_down numeric := abs(p_down_diff); l_top text; l_down text; v_level text;
begin
  l_top := case when a_top = 0 then 'ok' when a_top <= 0.1 then 'notice' when a_top <= 0.5 then 'alert' else 'critical' end;
  l_down := case when a_down <= v_allow / 2 then 'ok' when a_down <= v_allow then 'notice' when a_down <= 0.5 then 'alert' else 'critical' end;
  v_level := case when gold.scale_level_rank(l_top) >= gold.scale_level_rank(l_down) then l_top else l_down end;
  return jsonb_build_object('topLevel', l_top, 'downLevel', l_down, 'level', v_level, 'downAllowance', round(v_allow, 3));
end $$;

-- the original release stays as it was; the new one adds the scale on top of it
alter function gold.release_transfer(uuid, jsonb, uuid[]) rename to release_transfer_v1;

create function gold.release_transfer(p_id uuid, p jsonb, p_scope uuid[]) returns jsonb language plpgsql as $$
declare
  t gold.transfers; v_top numeric; v_down numeric; v_n int; v_chk jsonb; v_tdiff numeric; v_ddiff numeric; r jsonb;
begin
  if nullif(p->>'scaledTop', '') is null and nullif(p->>'scaledDown', '') is null then
    return gold.release_transfer_v1(p_id, p, p_scope);
  end if;
  if nullif(p->>'scaledTop', '') is null or nullif(p->>'scaledDown', '') is null then
    perform gold.fail(422, 'VALIDATION_FAILED', 'Enter both the scaled top and the scaled down weight.');
  end if;
  begin
    v_top := (p->>'scaledTop')::numeric; v_down := (p->>'scaledDown')::numeric;
  exception when others then
    perform gold.fail(422, 'VALIDATION_FAILED', 'The scaled weights must be numbers.');
  end;
  if v_top < 0 or v_down < 0 or v_top > 100000 or v_down > 100000 then perform gold.fail(422, 'VALIDATION_FAILED', 'The scaled weights are not sensible.'); end if;
  t := gold.transfer_for(p_id, 'origin', p_scope);
  if t.kind <> 'goods' then perform gold.fail(422, 'VALIDATION_FAILED', 'Only gold is scaled.'); end if;

  r := gold.release_transfer_v1(p_id, p, p_scope);
  select * into t from gold.transfers where id = p_id;
  select count(*) into v_n from gold.transfer_goods_lines where transfer_id = p_id;
  v_tdiff := round(v_top - t.declared_top, 4); v_ddiff := round(v_down - t.declared_down, 4);
  v_chk := gold.scale_check(v_tdiff, v_ddiff, t.declared_top, v_n);
  update gold.transfers set scaled_top = v_top, scaled_down = v_down, scaled_level = v_chk->>'level' where id = p_id;

  perform gold.audit('transfer.scaled', 'transfer', p_id::text,
    jsonb_build_object('booksTop', gold.ts(t.declared_top), 'booksDown', gold.ts(t.declared_down), 'pieces', v_n),
    jsonb_build_object('scaledTop', gold.ts(v_top), 'scaledDown', gold.ts(v_down), 'topDifference', gold.ts(v_tdiff), 'downDifference', gold.ts(v_ddiff), 'level', v_chk->>'level'));
  if v_chk->>'level' = 'critical' then
    perform gold.notify(t.tenant_id, 'transfer_scale_difference', format('%s: the scale does not match the books', t.reference),
      format('Books: top %s g, down %s g. Scale: top %s g, down %s g (difference %s g top, %s g down).',
             gold.ts(t.declared_top), gold.ts(t.declared_down), gold.ts(v_top), gold.ts(v_down), gold.ts(v_tdiff), gold.ts(v_ddiff)),
      '/transfers/' || p_id::text, array[t.origin_branch_id], 'discrepancies:review');
  end if;
  return gold.transfer_json(p_id);
end $$;

-- the transfer as shown: the original plus the scale and how it grades
alter function gold.transfer_json(uuid) rename to transfer_json_v1;

create function gold.transfer_json(p_id uuid) returns jsonb language sql stable as $$
  select gold.transfer_json_v1(p_id) || jsonb_build_object('scaled',
    (select case when t.scaled_top is null then null else
       jsonb_build_object('top', gold.ts(t.scaled_top), 'down', gold.ts(t.scaled_down),
         'topDifference', gold.ts(round(t.scaled_top - t.declared_top, 4)), 'downDifference', gold.ts(round(t.scaled_down - t.declared_down, 4)))
       || gold.scale_check(round(t.scaled_top - t.declared_top, 4), round(t.scaled_down - t.declared_down, 4), t.declared_top,
            (select count(*)::int from gold.transfer_goods_lines l where l.transfer_id = t.id)) end
     from gold.transfers t where t.id = p_id))
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'gold_app') then grant execute on all functions in schema gold to gold_app; end if;
end $$;