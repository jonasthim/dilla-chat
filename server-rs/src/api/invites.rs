use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::api::helpers::{json_ok, json_ok_true, require_permission, require_team_member, spawn_db};
use crate::api::AppState;
use crate::auth::UserId;
use crate::db;
use crate::error::AppError;

#[derive(Deserialize)]
pub struct CreateInviteRequest {
    #[serde(default)]
    pub max_uses: Option<i32>,
    #[serde(default)]
    pub expires_in_hours: Option<i64>,
}

pub async fn list(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let invites = spawn_db(state.db.clone(), move |conn| {
        require_team_member(conn, &user_id, &team_id)?;
        db::get_active_invites_by_team(conn, &team_id)
    })
    .await?;

    json_ok(invites)
}

pub async fn create(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path(team_id): Path<String>,
    Json(body): Json<CreateInviteRequest>,
) -> Result<Json<Value>, AppError> {
    let auth = state.auth.clone();

    let invite = spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_CREATE_INVITES)?;

        let now = db::now_str();
        let token = auth.generate_invite_token();

        let expires_at = body.expires_in_hours.map(|hours| {
            let expires = chrono::Utc::now() + chrono::Duration::hours(hours);
            expires.format("%Y-%m-%d %H:%M:%S").to_string()
        });

        let invite = db::Invite {
            id: db::new_id(),
            team_id: team_id.clone(),
            created_by: user_id.clone(),
            token,
            max_uses: body.max_uses,
            uses: 0,
            expires_at,
            revoked: false,
            created_at: now,
        };
        db::create_invite(conn, &invite)?;
        Ok(invite)
    })
    .await?;

    json_ok(invite)
}

pub async fn revoke(
    Extension(UserId(user_id)): Extension<UserId>,
    State(state): State<AppState>,
    Path((team_id, invite_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    spawn_db(state.db.clone(), move |conn| {
        require_permission(conn, &user_id, &team_id, db::PERM_CREATE_INVITES)?;

        let invite = db::get_invite_by_id(conn, &invite_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;

        if invite.team_id != team_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "invite does not belong to this team".into(),
            ));
        }

        db::revoke_invite(conn, &invite_id)?;
        Ok(())
    })
    .await
    .map_err(|e| match e {
        AppError::NotFound(_) => AppError::NotFound("invite not found".into()),
        other => other,
    })?;

    json_ok_true()
}

/// Public endpoint (no auth required) -- returns invite info for a token.
pub async fn get_invite_info(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>, AppError> {
    let info = spawn_db(state.db.clone(), move |conn| {
        let invite = validate_invite_token(conn, &token)?;
        let team = db::get_team(conn, &invite.team_id)?;

        Ok(serde_json::json!({
            "team_id": invite.team_id,
            "team_name": team.map(|t| t.name).unwrap_or_default(),
            "token": invite.token,
        }))
    })
    .await
    .map_err(|e| match e {
        AppError::Forbidden(msg) => AppError::BadRequest(msg),
        AppError::NotFound(_) => AppError::NotFound("invite not found".into()),
        other => other,
    })?;

    Ok(Json(info))
}

/// Validate an invite token: check existence, revocation, max uses, and expiry.
fn validate_invite_token(
    conn: &rusqlite::Connection,
    token: &str,
) -> Result<db::Invite, rusqlite::Error> {
    let invite = db::get_invite_by_token(conn, token)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

    if invite.revoked {
        return Err(rusqlite::Error::InvalidParameterName("invite has been revoked".into()));
    }
    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(rusqlite::Error::InvalidParameterName("invite max uses reached".into()));
        }
    }
    if let Some(ref expires) = invite.expires_at {
        if db::now_str() > *expires {
            return Err(rusqlite::Error::InvalidParameterName("invite has expired".into()));
        }
    }
    Ok(invite)
}
